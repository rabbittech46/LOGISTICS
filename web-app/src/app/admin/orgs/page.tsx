'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useOrganizations, useCreateOrganization } from '../../../hooks/queries';
import { api, ApiRequestError } from '../../../lib/api-client';
import { createOrgSchema, type CreateOrgFormData } from '../../../lib/validations';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { useUIStore } from '../../../stores/ui-store';
import { format } from 'date-fns';

const orgTypeColors: Record<string, string> = {
  CARRIER: 'bg-blue-500/20 text-blue-400',
  SHIPPER: 'bg-purple-500/20 text-purple-400',
  BROKER: 'bg-amber-500/20 text-amber-400',
};

interface Member {
  id: string;
  user_id: string;
  role: 'ORG_ADMIN' | 'DISPATCHER' | 'DRIVER' | 'SHIPPER_STAFF';
  is_active: boolean;
  joined_at: string | null;
  first_name: string;
  last_name: string;
  email: string;
}

interface UserSearchResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
}

export default function AdminOrgsPage() {
  const addToast = useUIStore((state) => state.addToast);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [inviteRole, setInviteRole] = useState<'ORG_ADMIN' | 'DISPATCHER' | 'DRIVER' | 'SHIPPER_STAFF'>('SHIPPER_STAFF');
  const { data, isLoading, error, refetch } = useOrganizations();
  const createOrg = useCreateOrganization();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOrgFormData>({
    resolver: zodResolver(createOrgSchema),
  });

  const orgs = data?.data ?? [];
  const effectiveSelectedOrgId = selectedOrgId || orgs[0]?.id || '';
  const selectedOrg = orgs.find((org) => org.id === effectiveSelectedOrgId) ?? null;

  const membersQuery = useQuery({
    queryKey: ['org-members', effectiveSelectedOrgId],
    queryFn: () => api.get<{ data: Member[] }>(`/api/v1/organizations/${effectiveSelectedOrgId}/members`),
    enabled: Boolean(effectiveSelectedOrgId),
  });

  const userSearchQuery = useQuery({
    queryKey: ['user-search', searchTerm],
    queryFn: () => api.get<{ data: UserSearchResult[] }>(`/api/v1/users/search?q=${encodeURIComponent(searchTerm.trim())}`),
    enabled: searchTerm.trim().length >= 2,
  });

  const inviteMember = useMutation({
    mutationFn: async (payload: { userId: string; role: string }) => api.post(`/api/v1/organizations/${effectiveSelectedOrgId}/members`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', effectiveSelectedOrgId] });
      setSearchTerm('');
    },
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => api.delete(`/api/v1/organizations/${effectiveSelectedOrgId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', effectiveSelectedOrgId] });
    },
  });

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const members = membersQuery.data?.data ?? [];
  const searchResults = userSearchQuery.data?.data ?? [];
  const memberUserIds = new Set(members.map((member) => member.user_id));

  const stats = {
    total: orgs.length,
    carriers: orgs.filter((org) => org.org_type === 'CARRIER').length,
    shippers: orgs.filter((org) => org.org_type === 'SHIPPER').length,
    members: members.length,
  };

  const groupedMembers = members.reduce<Record<string, Member[]>>((groups, member) => {
    const groupKey = member.role;
    groups[groupKey] = groups[groupKey] ?? [];
    groups[groupKey].push(member);
    return groups;
  }, {});

  const onSubmit = async (formData: CreateOrgFormData) => {
    try {
      const created = await createOrg.mutateAsync(formData);
      addToast({ type: 'success', title: 'Organization created' });
      setShowForm(false);
      reset();
      setSelectedOrgId(created.data?.id ?? effectiveSelectedOrgId);
    } catch {
      addToast({ type: 'error', title: 'Failed to create organization' });
    }
  };

  const handleInvite = async (userId: string) => {
    try {
      await inviteMember.mutateAsync({ userId, role: inviteRole });
      addToast({ type: 'success', title: 'Member added', message: 'Organization access was granted successfully.' });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Failed to add member', message });
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId);
      addToast({ type: 'info', title: 'Member removed' });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Failed to remove member', message });
    }
  };

  return (
    <div className="animate-in">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Organizations</h1>
          <p className="text-sm text-gray-400 mt-1">Manage company records and control who can operate inside each organization.</p>
        </div>
        <Button data-testid="toggle-org-form" size="sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Close form' : '+ New Org'}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Orgs" value={stats.total} />
        <StatCard label="Carriers" value={stats.carriers} />
        <StatCard label="Shippers" value={stats.shippers} />
        <StatCard label="Members In View" value={stats.members} />
      </div>

      {showForm && (
        <Card className="mb-5 border-blue-500/30">
          <h2 className="font-semibold text-white mb-3">New Organization</h2>
          <form data-testid="create-org-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-3 lg:grid-cols-2">
            <Input label="Name" placeholder="Acme Trucking Co." error={errors.name?.message} {...register('name')} />
            <Select
              label="Type"
              options={[{ value: 'CARRIER', label: 'Carrier' }, { value: 'SHIPPER', label: 'Shipper' }]}
              error={errors.orgType?.message}
              {...register('orgType')}
            />
            <Input label="Contact Email" type="email" placeholder="ops@acme.com" error={errors.contactEmail?.message} {...register('contactEmail')} />
            <Input label="Contact Phone" placeholder="(555) 123-4567" error={errors.contactPhone?.message} {...register('contactPhone')} />
            <Input label="DOT Number" placeholder="1234567" error={errors.dotNumber?.message} {...register('dotNumber')} />
            <Input label="MC Number" placeholder="MC-123456" error={errors.mcNumber?.message} {...register('mcNumber')} />
            <div className="lg:col-span-2">
              <Button data-testid="create-org-submit" type="submit" loading={createOrg.isPending}>Create Organization</Button>
            </div>
          </form>
        </Card>
      )}

      {orgs.length === 0 ? (
        <EmptyState title="No organizations" description="Create the first organization to get started." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-white">Organization list</h2>
                <p className="text-sm text-gray-400 mt-1">Choose an organization to review and edit member access.</p>
              </div>
              <Badge className="bg-gray-700/60 text-gray-200">{orgs.length}</Badge>
            </div>

            <div className="space-y-2">
              {orgs.map((org) => {
                const isSelected = org.id === effectiveSelectedOrgId;
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-blue-500/50 bg-blue-500/10'
                        : 'border-gray-700/60 bg-gray-900/40 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <p className="font-medium text-sm text-white">{org.name}</p>
                      <Badge className={orgTypeColors[org.org_type] ?? 'bg-gray-700 text-gray-300'}>{org.org_type}</Badge>
                      {org.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Inactive</Badge>}
                    </div>
                    <p className="text-xs text-gray-500">DOT: {org.dot_number ?? '—'} • MC: {org.mc_number ?? '—'}</p>
                    <p className="text-xs text-gray-500 mt-1">Created {format(new Date(org.created_at), 'MMM yyyy')}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="space-y-5">
            <Card>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-white">Member administration</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    {selectedOrg ? `Manage access for ${selectedOrg.name}` : 'Choose an organization to manage users.'}
                  </p>
                </div>
                {selectedOrg && <Badge className={orgTypeColors[selectedOrg.org_type] ?? 'bg-gray-700 text-gray-300'}>{selectedOrg.org_type}</Badge>}
              </div>

              {!selectedOrg ? (
                <EmptyState title="No organization selected" description="Select an organization from the left to manage its members." />
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_10rem]">
                    <Input
                      label="Find existing user"
                      placeholder="Search by name or email"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                    />
                    <Select
                      label="Role"
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}
                      options={[
                        { value: 'ORG_ADMIN', label: 'Org Admin' },
                        { value: 'DISPATCHER', label: 'Dispatcher' },
                        { value: 'DRIVER', label: 'Driver' },
                        { value: 'SHIPPER_STAFF', label: 'Shipper Staff' },
                      ]}
                    />
                    <div className="flex items-end text-xs text-gray-500">
                      Search at least 2 characters to invite an existing user.
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {searchTerm.trim().length < 2 ? (
                      <div className="rounded-2xl border border-dashed border-gray-700/60 bg-gray-900/40 px-4 py-6 text-sm text-gray-500">
                        Start typing a name or email to search the user directory.
                      </div>
                    ) : userSearchQuery.isLoading ? (
                      <div className="rounded-2xl border border-gray-700/60 bg-gray-900/40 px-4 py-6 text-sm text-gray-400">Searching users...</div>
                    ) : searchResults.length === 0 ? (
                      <div className="rounded-2xl border border-gray-700/60 bg-gray-900/40 px-4 py-6 text-sm text-gray-500">No matching users found.</div>
                    ) : (
                      searchResults.map((user) => {
                        const alreadyMember = memberUserIds.has(user.id);
                        return (
                          <div key={user.id} className="rounded-2xl border border-gray-700/60 bg-gray-900/60 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-white">{user.firstName} {user.lastName}</p>
                                <p className="text-sm text-gray-400 mt-1">{user.email}</p>
                              </div>
                              <Button
                                disabled={alreadyMember}
                                loading={inviteMember.isPending}
                                onClick={() => handleInvite(user.id)}
                              >
                                {alreadyMember ? 'Already a member' : 'Add member'}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-white">Current members</h2>
                  <p className="text-sm text-gray-400 mt-1">Operational access by role inside the selected organization.</p>
                </div>
                <Badge className="bg-gray-700/60 text-gray-200">{members.length} active</Badge>
              </div>

              {membersQuery.isLoading ? (
                <div className="rounded-2xl border border-gray-700/60 bg-gray-900/40 px-4 py-6 text-sm text-gray-400">Loading members...</div>
              ) : members.length === 0 ? (
                <EmptyState title="No members yet" description="Invite users above to start operating this organization." />
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedMembers).map(([role, roleMembers]) => (
                    <div key={role}>
                      <div className="flex items-center gap-2 mb-3">
                        <Badge className="bg-gray-700/60 text-gray-200">{role.replace('_', ' ')}</Badge>
                        <span className="text-xs text-gray-500">{roleMembers.length} member(s)</span>
                      </div>
                      <div className="space-y-2">
                        {roleMembers.map((member) => (
                          <div key={member.id} className="rounded-2xl border border-gray-700/60 bg-gray-900/60 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-white">{member.first_name} {member.last_name}</p>
                                <p className="text-sm text-gray-400 mt-1">{member.email}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                  Joined {member.joined_at ? format(new Date(member.joined_at), 'MMM d, yyyy') : 'Pending'}
                                </p>
                              </div>
                              <Button
                                variant="danger"
                                size="sm"
                                loading={removeMember.isPending}
                                onClick={() => handleRemove(member.user_id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
