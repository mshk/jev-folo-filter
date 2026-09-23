# Jev Folo Filter

[English](README.md) | [日本語](README.ja.md)

Fetch articles from your [Folo](https://github.com/RSSNext/Folo) subscriptions, evaluate them with [Jev / TypeSafe AI](https://docs.typesafe.ai/introduction), and build a reading list. Inspect scores for **every article**, including rejected ones.

An experimental Node.js CLI. It evaluates the title and available RSS description, not necessarily the full article. Scores are model judgments, not fact checks or a validated measure of reading quality. Terminal messages and generated reports currently use Japanese; these READMEs are bilingual.

## Features

- Fetch the latest timeline or distribute candidates across subscriptions so quieter feeds are included.
- Personal mode: use a local reader policy, balance topics, cap AI stories, and limit market coverage to one story.
- Editorial mode: evaluate discovery, explanatory depth, practical learning, and significance without a personal profile or topic quotas.
- Use Jev Score, Choice, and Noul for scoring, classification, and semantic duplicate checks.
- Save articles, decisions, model IDs, token usage, a Markdown digest, and all-article evaluations.
- Read saved scores offline without API credentials or additional inference.

## Setup

Requires Node.js **22.9 or newer** and npm. Run commands from the repository root.

```sh
git clone https://github.com/mshk/jev-folo-filter.git
cd jev-folo-filter
npm ci
cp .env.example .env
cp PROMPT.example.md PROMPT.md
```

Set `TYPESAFE_API_KEY` in `.env`, then edit `PROMPT.md` to describe your interests. Both files are ignored by Git. Without a local `PROMPT.md`, personal mode falls back to `PROMPT.example.md`.

Authenticate Folo using its official CLI:

```sh
npm run login
```

The browser login stores a session in `~/.folo/config.json`. Alternatively, set `FOLO_TOKEN` in `.env` to your Folo session token. Log in again when the session expires. A Folo password is not passed to this application. `JEV_MODEL` defaults to `jev-latest`; the resolved model ID is recorded in each result.

## Fetch and curate

```sh
# Latest 300 unread articles across the timeline
npm start -- --unread-only --limit 300 --count 10

# Include quieter feeds: up to 10 articles per subscription, 300 overall
npm start -- --unread-only --limit 300 --per-feed 10 --count 10

# Fetch only; no Jev calls
npm run fetch -- --unread-only --limit 300 --per-feed 10

# Re-evaluate saved articles; no Folo calls
npm run filter -- --input output/articles.json --count 10

# Personal mode: at most two AI-related articles
npm run filter -- --max-ai 2
```

Without `--unread-only`, read articles are included. Fetching does not mark articles as read or modify subscriptions. Folo's existing server timeline is read; source RSS feeds are not forcibly refreshed.

`--per-feed` fetches each subscription independently, then selects its first, second, and subsequent articles in rounds. Within a round, newer articles come first. Article IDs are deduplicated. A subscribed list counts as one retrieval target. The result may contain fewer than `--limit` articles if the per-feed pools are too small. The final saved list is sorted by publication date. Increase `--per-feed` if you need a larger pool. This mode deliberately includes older articles from quieter feeds.

## Evaluate intrinsic reading value

```sh
npm run filter -- --editorial --min-score 2 --input output/articles.json --output output/editorial --show-scores
```

Editorial mode uses `EDITORIAL.md` instead of your personal profile. It ranks by reading value, with source quality as a tie-breaker, and removes topic balancing, AI caps, and the one-market-story cap. Duplicate checks still apply. It cannot be combined with `--prompt` or `--max-ai`.

The default threshold is 2.5 in either mode. The example explicitly uses 2, meaning “worth a look” on the editorial rubric, rather than a strong recommendation. Tune thresholds on your own articles.

## Inspect every evaluation

```sh
# Saved results only: no API calls, API keys, or policy file needed
npm run scores
npm run scores -- --input output/editorial/selected.json

# Re-evaluate and display all scores instead of the digest
npm run filter -- --show-scores
```

All selected and excluded articles are displayed in descending score order. The report includes interest/reading value (0–4), source quality (0–2), confidence, category, AI probability, AI-cap classification, selection/exclusion reason, duplicate comparison, and article URL. Confidence is separate from the score and is not the probability of selection. Missing legacy audit fields are shown as unrecorded rather than inferred.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--limit` | `200` | Maximum fetched candidates, 1–2000 |
| `--per-feed` | unset | Fetch 1–100 articles per subscription before distributing candidates; fetch/run only |
| `--unread-only` | false | Fetch unread articles only |
| `--count` | `10` | Maximum selected articles, 1–50 |
| `--min-score` | `2.5` | Minimum score, 0–4 |
| `--max-ai` | 30% of count, rounded down, minimum 1 | AI cap in personal mode; accepts 0–count |
| `--editorial` | false | Use intrinsic reading value instead of personal interests |
| `--prompt` | local `PROMPT.md` or sample | Custom personal policy path |
| `--input` | `output/articles.json` | Filter input; scores uses `output/selected.json` |
| `--output` | `output` | Directory for fetch/filter/run results |
| `--show-scores` | false | Display and save all evaluations after filter/run |

## Outputs and evaluation logic

| File | Contents |
| --- | --- |
| `articles.json` | Normalized articles and fetch metadata |
| `selected.json` | Selected/excluded articles, settings, raw judgments, model IDs and token usage |
| `digest.md` | Selected reading list |
| `evaluations.md` | All-article score report when `--show-scores` is set |

Descriptions are converted from HTML to text and limited to 2,000 characters. Jev evaluates batches of eight. Personal mode first applies the score threshold, then favors underrepresented topics; within each topic, source quality precedes interest. AI development tools also count toward the AI cap. Semantic overlap at Noul ≥ 0.65 is treated as a duplicate. Editorial mode ranks reading value first. Neither mode fills the list with below-threshold articles.

Jev returns structured judgments, not generated prose. Short reasons in the digest are fixed phrases selected by category or reading-value reason. Topic categories and personal-mode quotas are implemented in `src/filter.js`; changing the policy alone does not change those rules.

Reusing an output directory replaces matching files. On failure the command exits with code 1; older reports may remain, so check the exit code and `generatedAt`. Timestamp pagination is not an immutable snapshot and may have boundary limitations for simultaneous publications.

## Privacy and validation

Personal policies and article text are sent to TypeSafe when evaluating, incurring API charges. Folo credentials are used only for Folo requests. `.env`, local `PROMPT.md`, downloaded articles, generated reports, and `node_modules` are excluded from Git. Do not commit custom private outputs or profiles placed elsewhere.

```sh
npm test
# Optional paid API smoke test with explicitly fictional articles
npm run filter -- --input examples/articles.json --output output/smoke
```

Offline tests cover pagination, fair retrieval, deduplication, topic caps, editorial mode, malformed responses, and score rendering. GitHub Actions runs them on Node.js 22 and 24 without secrets. Live Folo retrieval and Jev evaluation have been exercised during development; this is not a benchmark of recommendation accuracy. Private live results are not included.

## License and upstream projects

Original code and documentation: [MIT](LICENSE). Dependencies retain their own licenses; in particular, the separately invoked [Folo CLI](https://github.com/RSSNext/Folo/tree/dev/apps/cli) is AGPL-3.0-only and is not relicensed by this project. Dependencies are installed through npm, not vendored here. Lockfile overrides pin patched versions of `better-auth`, `drizzle-orm`, and `nanoid`.

References: [Folo](https://github.com/RSSNext/Folo), [TypeSafe API](https://docs.typesafe.ai/api), [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript).
