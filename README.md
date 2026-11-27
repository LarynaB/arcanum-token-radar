# Arcanum Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/LarynaB/arcanum-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/LarynaB/arcanum-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Empirical peer-multiple **Token Launch Radar & Farm Board** built for [make.fun](https://make.fun/bounty/token-radar-01)'s `token-radar-01` bounty ($1,325 USDC).

## Valuation Model

Derives implied FDV strictly from the sealed DefiLlama snapshot (`snapshot.json`), with zero hardcoded protocol names:

`implied_value_usd = tvl_usd × peer_multiple × momentum_mult × maturity_mult × chain_mult`

- **Peer Multiple:** Empirical median `mcap_usd / tvl_usd` of live-token protocols in the same category, Bayesian-shrunk toward the global live-token median.
- **7d Momentum:** Bounded multiplier `[0.80, 1.35]` from `change_7d`.
- **Tokenless Maturity:** Bounded multiplier `[0.88, 1.25]` from days since `listed_at`.
- **Multi-Chain Breadth:** Bounded multiplier `[1.00, 1.18]` from `chains.length`.
- **Farm Plans:** 4 concrete steps per protocol with estimated capital/gas cost and time horizon tailored by category and chain.

## Run Locally (Node.js 22.18+)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```
