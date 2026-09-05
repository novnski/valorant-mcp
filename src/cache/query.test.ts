import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { query, transaction } from "./query";

test("many queries and a committed transaction release all statements on strict close", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE values_test (value INTEGER)");
  transaction(db, () => {
    for (let i = 0; i < 50; i++) query(db, `INSERT INTO values_test VALUES (?) /* query ${i} */`).run(i);
  });
  expect(query(db, "SELECT COUNT(*) AS total FROM values_test").get()).toEqual({ total: 50 });
  expect(() => db.close(true)).not.toThrow();
});

test("a failed cache transaction rolls back every partial write and closes cleanly", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE values_test (value INTEGER UNIQUE)");
  expect(() =>
    transaction(db, () => {
      query(db, "INSERT INTO values_test VALUES (?)").run(1);
      query(db, "INSERT INTO values_test VALUES (?)").run(1);
    }),
  ).toThrow();
  expect(query(db, "SELECT COUNT(*) AS total FROM values_test").get()).toEqual({ total: 0 });
  expect(db.inTransaction).toBe(false);
  expect(() => db.close(true)).not.toThrow();
});
