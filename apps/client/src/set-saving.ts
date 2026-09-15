/** Serialize mutations while keeping failed/unsaved work available to the editor. */
export class SetSaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private blocked = new Set<string>();
  private revisions = new Map<string, number>();
  private generations = new Map<string, number>();

  remember(id: string, revision: number | undefined): void {
    if (revision !== undefined) this.revisions.set(id, revision);
  }

  revision(id: string): number | undefined {
    return this.revisions.get(id);
  }
  unblock(id: string): void {
    this.blocked.delete(id);
  }
  isBlocked(id: string): boolean {
    return this.blocked.has(id);
  }

  save<T extends { revision?: number }>(
    id: string,
    operation: (revision: number | undefined) => Promise<T>,
    apply: (result: T) => void,
  ): Promise<void> {
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    const task = this.tail.then(async () => {
      if (this.blocked.has(id)) return;
      try {
        const result = await operation(this.revision(id));
        this.remember(id, result.revision);
        if (this.generations.get(id) === generation) apply(result);
      } catch (error) {
        this.blocked.add(id);
        throw error;
      }
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
}
