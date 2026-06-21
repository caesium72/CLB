/**
 * Hardhat block miner used by Attack I experiments.
 */

export class BlockTicker {
  constructor(provider, intervalMs, options = {}) {
    this.provider = provider;
    this.intervalMs = intervalMs;
    this.advanceSecondsPerBlock = Number.isFinite(options.advanceSecondsPerBlock)
      ? Math.max(0, options.advanceSecondsPerBlock)
      : 0;
    this.running = false;
    this.blocksMined = 0;
    this.blockWallTimes = new Map();
    this._loopPromise = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loopPromise = this._loop();
  }

  async _loop() {
    while (this.running) {
      try {
        if (this.advanceSecondsPerBlock > 0) {
          const latest = await this.provider.send("eth_getBlockByNumber", ["latest", false]);
          const nextTimestamp = parseInt(latest.timestamp, 16) + this.advanceSecondsPerBlock;
          await this.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);
        }
        await this.provider.send("evm_mine", []);
        const latest = await this.provider.send("eth_getBlockByNumber", ["latest", false]);
        const blockNumber = parseInt(latest.number, 16);
        this.blocksMined++;
        this.blockWallTimes.set(blockNumber, Date.now());
      } catch {
        // The caller will observe failures through missing blocks/receipts.
      }
      if (this.running) {
        await new Promise(r => setTimeout(r, this.intervalMs));
      }
    }
  }

  async stop() {
    this.running = false;
    if (this._loopPromise) {
      await this._loopPromise;
      this._loopPromise = null;
    }
  }

  getStats() {
    return {
      blocksMined: this.blocksMined,
      intervalMs: this.intervalMs,
      advanceSecondsPerBlock: this.advanceSecondsPerBlock,
    };
  }

  getTimeAtBlock(blockNumber) {
    return this.blockWallTimes.get(blockNumber) ?? null;
  }
}
