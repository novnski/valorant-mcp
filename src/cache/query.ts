import type { Database, SQLQueryBindings, Statement } from "bun:sqlite";

/** Finalize every statement, including queries beyond Bun's internal cache limit. */
export function query(db: Database, sql: string) {
  function execute<T>(operation: (statement: Statement<unknown, SQLQueryBindings[]>) => T): T {
    const statement = db.prepare<unknown, SQLQueryBindings[]>(sql);
    try {
      return operation(statement);
    } finally {
      statement.finalize();
    }
  }
  return {
    get: (...params: SQLQueryBindings[]) => execute((statement) => statement.get(...params)),
    all: (...params: SQLQueryBindings[]) => execute((statement) => statement.all(...params)),
    run: (...params: SQLQueryBindings[]) => execute((statement) => statement.run(...params)),
  };
}

/** Bun 1.3.8's transaction helper retains statements until GC; explicit SQL closes cleanly. */
export function transaction<T>(db: Database, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
