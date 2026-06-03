import type { EvidenceEvent } from "@clb-acel/schemas";
import { hashEvidenceEvent } from "@clb-acel/evidence-core";
import pg from "pg";

const { Pool } = pg;

export type StoredEvidenceEvent = {
  event: EvidenceEvent;
  eventHash: `0x${string}`;
};

export type EvidenceRepository = {
  appendEvent(event: EvidenceEvent): Promise<StoredEvidenceEvent>;
  getTraceEvents(traceId: string): Promise<StoredEvidenceEvent[]>;
  close(): Promise<void>;
};

function enforcePreviousEventHash(
  input: EvidenceEvent,
  previousEventHash: `0x${string}` | undefined,
): EvidenceEvent {
  if (!previousEventHash) {
    const { previousEventHash: _callerPreviousEventHash, ...genesisEvent } = input;
    void _callerPreviousEventHash;
    return genesisEvent;
  }

  return {
    ...input,
    previousEventHash,
  };
}

export function createInMemoryEvidenceRepository(): EvidenceRepository {
  const traces = new Map<string, StoredEvidenceEvent[]>();

  return {
    async appendEvent(input) {
      const traceEvents = traces.get(input.traceId) ?? [];
      const previous = traceEvents.at(-1);
      const event = enforcePreviousEventHash(input, previous?.eventHash);
      const stored = { event, eventHash: hashEvidenceEvent(event) };

      traces.set(input.traceId, [...traceEvents, stored]);
      return stored;
    },
    async getTraceEvents(traceId) {
      return traces.get(traceId) ?? [];
    },
    async close() {
      traces.clear();
    },
  };
}

type DbRow = {
  event_sequence: string;
  trace_id: string;
  event_id: string;
  protocol: EvidenceEvent["protocol"];
  object_type: string;
  actor: string;
  event_timestamp: Date;
  object_hash: `0x${string}`;
  previous_event_hash: `0x${string}` | null;
  public_fields: Record<string, unknown>;
  private_ref: string | null;
  signature: `0x${string}`;
  event_hash: `0x${string}`;
};

function rowToStoredEvent(row: DbRow): StoredEvidenceEvent {
  const event: EvidenceEvent = {
    traceId: row.trace_id,
    eventId: row.event_id,
    protocol: row.protocol,
    objectType: row.object_type,
    actor: row.actor,
    timestamp: row.event_timestamp.toISOString(),
    objectHash: row.object_hash,
    publicFields: row.public_fields,
    signature: row.signature,
    ...(row.previous_event_hash ? { previousEventHash: row.previous_event_hash } : {}),
    ...(row.private_ref ? { privateRef: row.private_ref } : {}),
  };

  return {
    event,
    eventHash: row.event_hash,
  };
}

export async function createPostgresEvidenceRepository(
  databaseUrl: string,
): Promise<EvidenceRepository> {
  const useSslObject = process.env.DATABASE_SSL !== "false" && !databaseUrl.includes("sslmode=");
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(useSslObject ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  await pool.query(`
    create table if not exists evidence_events (
      trace_id text not null,
      event_id text not null,
      protocol text not null,
      object_type text not null,
      actor text not null,
      event_timestamp timestamptz not null,
      object_hash text not null,
      previous_event_hash text,
      public_fields jsonb not null default '{}'::jsonb,
      private_ref text,
      signature text not null,
      event_hash text not null,
      event_sequence bigserial not null,
      created_at timestamptz not null default now(),
      primary key (trace_id, event_id),
      unique (trace_id, event_hash)
    );
  `);
  await pool.query(`
    alter table evidence_events
    add column if not exists event_sequence bigserial;
  `);

  return {
    async appendEvent(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          input.traceId,
        ]);

        const previousResult = await client.query<Pick<DbRow, "event_hash">>(
          `
            select event_hash
            from evidence_events
            where trace_id = $1
            order by event_sequence desc
            limit 1
            for update
          `,
          [input.traceId],
        );
        const previousEventHash = previousResult.rows[0]?.event_hash;
        const event = enforcePreviousEventHash(input, previousEventHash);
        const eventHash = hashEvidenceEvent(event);

        const insertResult = await client.query<DbRow>(
          `
            insert into evidence_events (
              trace_id,
              event_id,
              protocol,
              object_type,
              actor,
              event_timestamp,
              object_hash,
              previous_event_hash,
              public_fields,
              private_ref,
              signature,
              event_hash
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
            returning *
          `,
          [
            event.traceId,
            event.eventId,
            event.protocol,
            event.objectType,
            event.actor,
            event.timestamp,
            event.objectHash,
            event.previousEventHash ?? null,
            JSON.stringify(event.publicFields),
            event.privateRef ?? null,
            event.signature,
            eventHash,
          ],
        );

        await client.query("commit");

        const row = insertResult.rows[0];
        if (!row) {
          throw new Error("Postgres did not return inserted evidence event");
        }

        return rowToStoredEvent(row);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    async getTraceEvents(traceId) {
      const result = await pool.query<DbRow>(
        `
          select *
          from evidence_events
          where trace_id = $1
          order by event_sequence asc
        `,
        [traceId],
      );

      return result.rows.map(rowToStoredEvent);
    },
    async close() {
      await pool.end();
    },
  };
}
