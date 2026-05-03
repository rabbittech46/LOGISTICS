declare module 'pg-copy-streams' {
  import { Writable, Readable } from 'node:stream';
  import { QueryConfig } from 'pg';
  export interface CopyStreamQuery extends Writable, QueryConfig {
    submit(connection: any): void;
  }
  export interface CopyToStreamQuery extends Readable, QueryConfig {
    submit(connection: any): void;
  }
  export function from(queryText: string): CopyStreamQuery;
  export function to(queryText: string): CopyToStreamQuery;
}
