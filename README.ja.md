# Jev Folo Filter

[English](README.md) | [日本語](README.ja.md)

[Folo](https://github.com/RSSNext/Folo)の購読記事を取得し、[Jev / TypeSafe AI](https://docs.typesafe.ai/introduction)で評価して読む記事を選ぶCLIです。**除外記事を含む全件の採点**も確認できます。

実験的なNode.jsツールです。タイトルとRSSの概要を評価するため、本文全体を読んだ評価とは限りません。点数はモデルの判断であり、事実確認や読書価値の客観的な保証ではありません。CLIのメッセージと出力は現在日本語、READMEは英語・日本語に対応しています。

## 機能

- 全体の最新記事、または購読フィードごとに分散した記事を取得。更新の少ない媒体も候補に入れられます。
- 個人向けモード：ローカルの嗜好設定に基づいて採点し、分野を分散。AI記事数と市況記事数を制限します。
- 編集モード：個人の嗜好や分野別上限を使わず、発見・説明の深さ・具体的な学び・重要性を評価します。
- JevのScore・Choice・Noulで採点、分類、意味的な重複判定を実行します。
- 記事、採用・除外、モデル名、トークン使用量、ダイジェスト、全件評価を保存します。
- 保存済み評価はAPIキーや再評価なしで表示できます。

## セットアップ

Node.js **22.9以上**とnpmが必要です。コマンドはリポジトリのルートで実行します。

```sh
git clone https://github.com/mshk/jev-folo-filter.git
cd jev-folo-filter
npm ci
cp .env.example .env
cp PROMPT.example.md PROMPT.md
```

`.env`に`TYPESAFE_API_KEY`を設定し、`PROMPT.md`に自分の関心を書いてください。どちらもGitの対象外です。ローカルの`PROMPT.md`がなければ`PROMPT.example.md`を使います。

Folo公式CLIで認証します。

```sh
npm run login
```

ブラウザーログイン後、セッションは`~/.folo/config.json`に保存されます。代わりに`.env`の`FOLO_TOKEN`へFoloのセッショントークンを設定する方法もあります。期限切れ時は再ログインしてください。このアプリにFoloのパスワードを渡す必要はありません。`JEV_MODEL`は既定で`jev-latest`、実際に応答したモデル名は結果に保存されます。

## 取得と選別

```sh
# 全体の最新未読300件から10件を選ぶ
npm start -- --unread-only --limit 300 --count 10

# 更新の少ない媒体も含める：購読先ごとに最大10件、全体最大300件
npm start -- --unread-only --limit 300 --per-feed 10 --count 10

# 取得のみ。Jevは呼び出さない
npm run fetch -- --unread-only --limit 300 --per-feed 10

# 保存した記事を再評価。Foloは呼び出さない
npm run filter -- --input output/articles.json --count 10

# 個人向けモードでAI記事を最大2件に制限
npm run filter -- --max-ai 2
```

`--unread-only`を外すと既読も含みます。既読化や購読変更は行いません。Foloサーバーに取り込まれた記事を読む処理であり、RSS配信元を強制更新するものではありません。

`--per-feed`では各購読先から取得し、各先の1件目、2件目……の順で全体上限まで集めます。同じ順番では新しい記事を優先し、同一記事IDを重複排除します。購読リストはリスト全体で1取得先です。各先の候補が少なければ`--limit`未満になり、より多く集めるには`--per-feed`を増やします。保存時は公開日時順です。このモードでは更新の少ない媒体の古い記事も意図的に含めます。

## 嗜好を使わず記事自体の価値を評価

```sh
npm run filter -- --editorial --min-score 2 --input output/articles.json --output output/editorial --show-scores
```

編集モードは個人プロフィールの代わりに`EDITORIAL.md`を使います。「読む価値」を優先し、同点では一次情報・充実度を優先します。分野分散、AI上限、市況1件制限は使いません。重複除外は継続します。`--prompt`・`--max-ai`とは併用できません。

足切りは両モードとも既定2.5点です。上の例では明示的に2点へ下げており、編集モードの基準では「目を通す価値がある候補」を意味し、強い推薦とは異なります。閾値は実際の記事で調整してください。

## 全記事の評価を確認

```sh
# 保存済み結果の表示だけ。API呼び出し・キー・プロンプト不要
npm run scores
npm run scores -- --input output/editorial/selected.json

# 再評価し、ダイジェストの代わりに全件の評価を表示
npm run filter -- --show-scores
```

採用・除外を含む全記事を点数の高い順に表示します。関心度／読む価値（0〜4）、一次情報・充実度（0〜2）、確信度、分類、AI確率、AI枠への該当、採用・除外理由、重複比較、記事URLを確認できます。確信度は点数や採用確率とは別です。旧形式で記録がない値は推測せず「未記録」と表示します。

## オプション

| オプション | 既定値 | 意味 |
| --- | --- | --- |
| `--limit` | `200` | 取得候補数の上限、1〜2000 |
| `--per-feed` | なし | 購読先ごとに1〜100件取得して分散、fetch/runのみ |
| `--unread-only` | false | 未読だけ取得 |
| `--count` | `10` | 選出上限、1〜50 |
| `--min-score` | `2.5` | 採点の足切り、0〜4 |
| `--max-ai` | 件数の3割、切り捨て・最低1件 | 個人向けのAI上限、0〜count |
| `--editorial` | false | 嗜好を使わず読む価値で評価 |
| `--prompt` | ローカルの`PROMPT.md`かサンプル | 個人向け基準のファイル |
| `--input` | `output/articles.json` | filterの入力。scoresでは`output/selected.json` |
| `--output` | `output` | fetch/filter/runの保存先 |
| `--show-scores` | false | filter/run後に全件評価を表示・保存 |

## 保存先と評価の仕組み

| ファイル | 内容 |
| --- | --- |
| `articles.json` | 正規化した記事と取得情報 |
| `selected.json` | 採用・除外、設定、生の判定、モデル名、トークン数 |
| `digest.md` | 選んだ記事の一覧 |
| `evaluations.md` | 全記事の評価（`--show-scores`指定時） |

概要はHTMLからテキスト化し、最大2000文字に制限します。8件ずつJevへ送信します。個人向けモードでは足切り後、採用数の少ない分野を優先。同じ分野では一次情報・充実度、関心度の順です。AI向け開発ツールもAI枠に含めます。Noulの重複確率が0.65以上なら同じ話題として除外します。編集モードでは読む価値を最優先します。どちらも基準未満の記事で件数を埋めません。

Jevが返すのは構造化された判定です。ダイジェストの短い理由は分類や読書理由に対応する定型文です。分類と個人向けの件数制限は`src/filter.js`にあり、プロンプトの文章だけでは変更されません。

同じ保存先ではファイルを置き換えます。失敗時は終了コード1になり、古いレポートが残る場合があるため、終了コードと`generatedAt`を確認してください。日時によるページ送りは厳密なスナップショットではなく、同時刻公開記事の境界などに制限があります。

## プライバシーと検証

評価時は個人プロンプトと記事テキストをTypeSafeへ送信し、API料金が発生します。Foloの認証情報はFoloへの取得にだけ使います。`.env`、ローカルの`PROMPT.md`、取得記事、生成物、`node_modules`はGit対象外です。別の場所に置いた個人設定や取得データも公開しないようにしてください。

```sh
npm test
# 任意の有料API接続確認。入力は明示的な架空記事
npm run filter -- --input examples/articles.json --output output/smoke
```

オフラインテストではページ送り、取得先の分散、重複除外、分野制限、編集モード、不正応答、評価表示を確認します。GitHub Actionsでは秘密情報を使わずNode.js 22・24で実行します。開発時にFoloの実取得とJev実API評価も確認していますが、推薦精度のベンチマークではありません。個人の実行結果は公開リポジトリに含めません。

## ライセンス・依存プロジェクト

このプロジェクト独自のコードとドキュメントは[MIT](LICENSE)です。依存関係にはそれぞれのライセンスが適用されます。別プロセスで呼び出す[Folo CLI](https://github.com/RSSNext/Folo/tree/dev/apps/cli)はAGPL-3.0-onlyであり、このプロジェクトでライセンスを変更するものではありません。依存コードは同梱せずnpmでインストールします。lockfileのoverridesで`better-auth`、`drizzle-orm`、`nanoid`の修正版を固定しています。

参照：[Folo](https://github.com/RSSNext/Folo)、[TypeSafe API](https://docs.typesafe.ai/api)、[TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)。
