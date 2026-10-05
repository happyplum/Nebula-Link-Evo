import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterImmediateTransactionCommit,
  bindAfterCommitErrorReporter,
  inImmediateTransaction,
  unbindAfterCommitErrorReporter,
  type AfterCommitCallbackFailure,
  type DatabaseLike,
} from '../semantic-repository-utils.js';

const databases: DatabaseSync[] = [];

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('CREATE TABLE committed_rows (value TEXT NOT NULL)');
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    unbindAfterCommitErrorReporter(db);
    db.close();
  }
  vi.restoreAllMocks();
});

describe('semantic repository transaction notifications', () => {
  it.each([
    {
      label: 'Error',
      thrown: new Error('private callback payload'),
      expected: { errorName: 'Error', errorConstructor: 'Error' },
    },
    {
      label: 'non-Error',
      thrown: 'private callback payload',
      expected: { thrownType: 'string' },
    },
  ] as const)(
    'preserves committed work and drains remaining callbacks when an $label callback fails',
    ({ thrown, expected }) => {
      const db = createDatabase();
      const reports: AfterCommitCallbackFailure[] = [];
      const callbackOrder: string[] = [];
      bindAfterCommitErrorReporter(db, (failure) => reports.push(failure));

      const result = inImmediateTransaction(db, () => {
        db.prepare('INSERT INTO committed_rows(value) VALUES (?)').run('persisted');
        afterImmediateTransactionCommit(db, () => {
          throw thrown;
        });
        afterImmediateTransactionCommit(db, () => callbackOrder.push('second'));
        afterImmediateTransactionCommit(db, () => callbackOrder.push('third'));
        return 'business-result';
      });

      expect(result).toBe('business-result');
      expect(db.prepare('SELECT value FROM committed_rows').all()).toEqual([{ value: 'persisted' }]);
      expect(callbackOrder).toEqual(['second', 'third']);
      expect(reports).toEqual([
        {
          code: 'after_commit_callback_failed',
          phase: 'post-commit-drain',
          callbackIndex: 0,
          ...expected,
        },
      ]);
      expect(JSON.stringify(reports)).not.toContain('private callback payload');
    }
  );

  it.each(['work', 'commit'] as const)(
    'propagates the original %s failure without running callbacks and clears the transaction registry',
    (failurePhase) => {
      const expectedError = new Error(`${failurePhase} failed`);
      const calls: string[] = [];
      const db: DatabaseLike = {
        exec(sql) {
          calls.push(sql);
          if (sql === 'COMMIT' && failurePhase === 'commit') throw expectedError;
        },
        prepare() {
          throw new Error('Unexpected SQL in transaction failure test');
        },
      };
      const reports: AfterCommitCallbackFailure[] = [];
      const callbackOrder: string[] = [];
      bindAfterCommitErrorReporter(db, (failure) => reports.push(failure));

      let caughtError: unknown;
      try {
        inImmediateTransaction(db, () => {
          afterImmediateTransactionCommit(db, () => callbackOrder.push('transaction'));
          if (failurePhase === 'work') throw expectedError;
          return 'uncommitted-result';
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBe(expectedError);
      expect(calls).toEqual(
        failurePhase === 'work' ? ['BEGIN IMMEDIATE', 'ROLLBACK'] : ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK']
      );
      expect(callbackOrder).toEqual([]);
      expect(reports).toEqual([]);
      afterImmediateTransactionCommit(db, () => callbackOrder.push('no-transaction'));
      expect(callbackOrder).toEqual(['no-transaction']);
    }
  );

  it('isolates immediate callbacks when no transaction is active', () => {
    const db = createDatabase();
    const reports: AfterCommitCallbackFailure[] = [];
    const callbackOrder: string[] = [];
    bindAfterCommitErrorReporter(db, (failure) => reports.push(failure));

    afterImmediateTransactionCommit(db, () => {
      throw new Error('private immediate payload');
    });
    afterImmediateTransactionCommit(db, () => callbackOrder.push('next call'));

    expect(callbackOrder).toEqual(['next call']);
    expect(reports).toEqual([
      {
        code: 'after_commit_callback_failed',
        phase: 'no-transaction',
        callbackIndex: 0,
        errorName: 'Error',
        errorConstructor: 'Error',
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain('private immediate payload');
  });

  it('contains reporter failures and writes only classified fields to the fallback sink', () => {
    const db = createDatabase();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    bindAfterCommitErrorReporter(db, () => {
      throw new Error('private reporter payload');
    });

    expect(() =>
      afterImmediateTransactionCommit(db, () => {
        throw new Error('private callback payload');
      })
    ).not.toThrow();

    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0]).toEqual([
      {
        code: 'after_commit_callback_failed',
        phase: 'no-transaction',
        callbackIndex: 0,
        errorName: 'Error',
        errorConstructor: 'Error',
      },
      'After-commit notification callback failed',
    ]);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('private');
  });

  it('uses the sanitized stderr fallback after unbinding the reporter', () => {
    const db = createDatabase();
    const reporter = vi.fn();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    bindAfterCommitErrorReporter(db, reporter);
    unbindAfterCommitErrorReporter(db);

    afterImmediateTransactionCommit(db, () => {
      throw 'private non-error payload';
    });

    expect(reporter).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      {
        code: 'after_commit_callback_failed',
        phase: 'no-transaction',
        callbackIndex: 0,
        thrownType: 'string',
      },
      'After-commit notification callback failed'
    );
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('private non-error payload');
  });
});
