// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Proof-of-Delivery Service
//
// 1. Generates S3 presigned PUT URLs for drivers to upload POD photos
// 2. Confirms delivery: marks assignment COMPLETED, load DELIVERED
// 3. Settles payment via double-entry ledger journal
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { pool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/app-error.js';
import type { PaymentStatus, UserRole } from '../../shared/types.js';
import { settlePayment } from './payment.service.js';

const s3 = new S3Client({ region: config.awsRegion });

export interface PodUploadRequest {
  assignmentId: string;
  fileCount: number;
}

export interface PodUploadUrl {
  key: string;
  uploadUrl: string;
}

export interface ConfirmDeliveryRequest {
  assignmentId: string;
  podPhotoKeys: string[];
  podSignatureUrl?: string;
  podNotes?: string;
}

export interface DeliveryResult {
  assignmentId: string;
  loadId: string;
  loadStatus: 'DELIVERED';
  paymentId: string;
  paymentStatus: 'RELEASED' | 'SETTLEMENT_PENDING';
  settlementAmountCents: number;
}

interface ActiveAssignmentRow {
  id: string;
}

interface AssignmentRow {
  id: string;
  load_id: string;
  carrier_org_id: string;
  driver_id: string;
  truck_id: string;
  agreed_rate_usd: number;
  status: string;
}

interface LoadRow {
  status: string;
}

interface PaymentRow {
  id: string;
  gross_amount_cents: number;
  status: PaymentStatus;
}

export async function generateUploadUrls(
  req: PodUploadRequest,
  userId: string,
): Promise<PodUploadUrl[]> {
  if (req.fileCount < 1 || req.fileCount > 10) {
    throw new AppError(400, 'fileCount must be between 1 and 10');
  }

  const assignment = await queryOne<ActiveAssignmentRow>(
    `SELECT a.id
       FROM logistics.assignments a
       JOIN logistics.driver_profiles d ON d.id = a.driver_id
      WHERE a.id = $1
        AND d.user_id = $2
        AND a.status = 'ACTIVE'`,
    [req.assignmentId, userId],
  );

  if (!assignment) {
    throw new AppError(404, 'Active assignment not found for this driver');
  }

  const urls: PodUploadUrl[] = [];
  for (let i = 0; i < req.fileCount; i += 1) {
    const key = `pod/${req.assignmentId}/${randomUUID()}.jpg`;
    const command = new PutObjectCommand({
      Bucket: config.s3PodBucket,
      Key: key,
      ContentType: 'image/jpeg',
      Metadata: {
        'assignment-id': req.assignmentId,
        'uploaded-by': userId,
      },
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    urls.push({ key, uploadUrl });
  }

  logger.info({ assignmentId: req.assignmentId, count: req.fileCount }, 'POD upload URLs generated');
  return urls;
}

export async function confirmDelivery(
  req: ConfirmDeliveryRequest,
  userId: string,
  orgId: string,
  role: UserRole,
): Promise<DeliveryResult> {
  const client = await pool.connect();
  let payment: PaymentRow | null = null;
  let loadId = '';

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const assignmentResult = await client.query<AssignmentRow>(
      `SELECT id, load_id, carrier_org_id, driver_id, truck_id, agreed_rate_usd, status
         FROM logistics.assignments
        WHERE id = $1
          FOR UPDATE`,
      [req.assignmentId],
    );

    if (assignmentResult.rows.length === 0) {
      throw new AppError(404, 'Assignment not found');
    }

    const assignment = assignmentResult.rows[0];
    loadId = assignment.load_id;

    if (assignment.status !== 'ACTIVE') {
      throw new AppError(409, `Assignment is ${assignment.status}, expected ACTIVE`);
    }

    if (role === 'DRIVER') {
      const ownsAssignment = await queryOne<ActiveAssignmentRow>(
        `SELECT a.id
           FROM logistics.assignments a
           JOIN logistics.driver_profiles d ON d.id = a.driver_id
          WHERE a.id = $1
            AND d.user_id = $2`,
        [req.assignmentId, userId],
      );

      if (!ownsAssignment) {
        throw new AppError(403, 'Only the assigned driver can submit POD for this load');
      }
    } else if (role !== 'PLATFORM_ADMIN' && assignment.carrier_org_id !== orgId) {
      throw new AppError(403, 'Only the assigned carrier can submit POD for this load');
    }

    const loadResult = await client.query<LoadRow>(
      `SELECT status
         FROM logistics.loads
        WHERE id = $1
          FOR UPDATE`,
      [assignment.load_id],
    );

    if (loadResult.rows.length === 0) {
      throw new AppError(404, 'Load not found');
    }

    if (loadResult.rows[0].status !== 'IN_TRANSIT') {
      throw new AppError(409, `Load is ${loadResult.rows[0].status}, expected IN_TRANSIT`);
    }

    const paymentResult = await client.query<PaymentRow>(
      `SELECT id, gross_amount_cents, status
         FROM logistics.payments
        WHERE assignment_id = $1
        ORDER BY created_at DESC
        LIMIT 1
          FOR UPDATE`,
      [req.assignmentId],
    );

    if (paymentResult.rows.length === 0) {
      throw new AppError(409, 'Escrow payment must be created before delivery can be confirmed');
    }

    payment = paymentResult.rows[0];
    if (!['ESCROW_HELD', 'PARTIALLY_RELEASED'].includes(payment.status)) {
      throw new AppError(409, `Payment is ${payment.status}, expected escrow to be held before delivery`);
    }

    const photoUrls = req.podPhotoKeys.map(
      (key) => `https://${config.s3PodBucket}.s3.${config.awsRegion}.amazonaws.com/${key}`,
    );

    await client.query(
      `UPDATE logistics.assignments
          SET status = 'COMPLETED',
              delivered_at = NOW(),
              pod_photos = $2,
              pod_signature_url = $3,
              pod_notes = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [req.assignmentId, photoUrls, req.podSignatureUrl ?? null, req.podNotes ?? null],
    );

    await client.query(
      `UPDATE logistics.loads
          SET status = 'DELIVERED', updated_at = NOW()
        WHERE id = $1`,
      [assignment.load_id],
    );

    await client.query(
      `UPDATE logistics.trucks
          SET status = 'AVAILABLE', updated_at = NOW()
        WHERE id = $1`,
      [assignment.truck_id],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    if ((err as any)?.code === '40001') {
      throw new AppError(409, 'Concurrent modification, please retry');
    }
    throw err;
  } finally {
    client.release();
  }

  let paymentStatus: 'RELEASED' | 'SETTLEMENT_PENDING' = 'RELEASED';
  try {
    await settlePayment({ paymentId: payment!.id, assignmentId: req.assignmentId }, userId);
  } catch (err) {
    paymentStatus = 'SETTLEMENT_PENDING';
    logger.error({ assignmentId: req.assignmentId, paymentId: payment!.id, err }, 'Delivery confirmed but settlement requires follow-up');
  }

  logger.info(
    {
      assignmentId: req.assignmentId,
      loadId,
      paymentId: payment!.id,
      paymentStatus,
    },
    'Delivery confirmed through POD workflow',
  );

  return {
    assignmentId: req.assignmentId,
    loadId,
    loadStatus: 'DELIVERED',
    paymentId: payment!.id,
    paymentStatus,
    settlementAmountCents: payment!.gross_amount_cents,
  };
}

async function queryOne<T>(
  text: string,
  params: unknown[],
): Promise<T | null> {
  const result = await pool.query(text, params);
  return (result.rows[0] as T | undefined) ?? null;
}
