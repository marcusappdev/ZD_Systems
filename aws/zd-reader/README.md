# Back-capture "Read automatically": AWS setup (zd-reader)

**Read automatically** on the Back-capture screen sends the pages of one scan set (up to 6 pages) to Claude on Amazon Bedrock. It then fills in the form. The person checks every value against the scan, and **nothing is saved until they press Save**.

It's the same pattern as DPM's `dpm-reader`, but ZD has **its own stack**. That gives it its own address, its own sign-in check, and its own logs.

- **What gets created:** `zd-reader.yaml` sets up a Lambda function, an HTTP API with a fixed `POST /read` route, and a sign-in check.
  - The sign-in check accepts only the Microsoft ID token of the **ZD Licensing** app registration. The issuer is `login.microsoftonline.com/<tenant>/v2.0` and the audience is the ZD client ID.
- **What the Lambda knows:** nothing about ZD's documents. The app sends the fields, what each one means, and the instructions with every request (`capReadRequest` in `shared/zd-capture.js`). To change what is read, change the app, not AWS.
- **Where pages go:** the **Australia** inference profile `au.anthropic.claude-haiku-4-5-20251001-v1:0`, which keeps the pages in Australian AWS regions.
- **What's stored:** nothing. Pages aren't saved in AWS. The logs record only who asked, the page count, token counts and errors, and are kept for 14 days.
- **Limits:** CORS allows only `https://marcusappdev.github.io`. The API allows about 1 request a second (bursts of 3).
  - The Bedrock limit for Haiku 4.5 (50 requests a minute) is **shared with DPM**.

## Account and cost

| | |
|---|---|
| Account | **Concept-RPYC-POC** (aws_poc@concept.com.pg), the same account as DPM and zd-face-api |
| Region | **Asia Pacific (Sydney) `ap-southeast-2`** |
| Bedrock | Already enabled and tested (use-case form and verification done). **Nothing to redo.** |
| Model | Claude Haiku 4.5, AU profile. Haiku 5.5 shows as "not available for this account". |
| Cost | About **US$0.005 per sheet**. The full back-capture (~20,000 sheets) comes to about **US$90–100**, which the remaining AWS credits (~US$120) cover. |

> **Before the bulk run:** the account's **monthly spend limit is US$20**, and the account **pauses** when it's reached. That would stop DPM, zd-face-api (and so ZD sign-in) and this reader. Raise it first: **AWS Settings > Projects > Edit spend limit**. A few test sets are fine at US$20.

## Deploy (CloudShell, one command at a time)

1. Sign in to the console. Check that the region at the top right is **Asia Pacific (Sydney)**, then open **CloudShell**.

2. Download the template. The repo is public, so this works once the pull request is merged:

   ```bash
   curl -O https://raw.githubusercontent.com/marcusappdev/ZD_Systems/main/aws/zd-reader/zd-reader.yaml
   ```

3. Create the stack. The defaults are already ZD's values: the Concept tenant, the ZD Licensing client ID, the AU Haiku 4.5 profile and `https://marcusappdev.github.io`. They're spelled out here so you can see them:

   ```bash
   aws cloudformation deploy --region ap-southeast-2 --stack-name zd-reader --template-file zd-reader.yaml --capabilities CAPABILITY_IAM --parameter-overrides TenantId=ea9e105c-2df6-47ef-a8e3-b4aa1d788423 ClientId=35593863-9ae0-4018-8dcc-a82a44e59c51 AllowedOrigin=https://marcusappdev.github.io ModelId=au.anthropic.claude-haiku-4-5-20251001-v1:0
   ```

   Wait for `Successfully created/updated stack - zd-reader`, which takes about 2 minutes.

   > Use the stack name **`zd-reader`** exactly. Never run this with `--stack-name dpm-reader`, because that would overwrite DPM's service.

4. Get the address:

   ```bash
   aws cloudformation describe-stacks --region ap-southeast-2 --stack-name zd-reader --query "Stacks[0].Outputs[?OutputKey=='ReadUrl'].OutputValue" --output text
   ```

   It looks like `https://abc123.execute-api.ap-southeast-2.amazonaws.com/read`. It will **not** be DPM's `wjf5agcpn2…` address.

5. Check that the sign-in lock works. With no token, the answer must be `{"message":"Unauthorized"}`:

   ```bash
   curl -s -X POST <ReadUrl from step 4>
   ```

## Switch it on in the app (a pull request)

In `shared/zd-config.js`:

```js
const ZD_READ_API = "https://abc123.execute-api.ap-southeast-2.amazonaws.com/read";   // zd-reader stack
...
  AUTO_READ:           true
```

After it's merged, open **Back-capture**, load a set, choose its kind and click **Read automatically**. The filled fields are shaded. Any field it couldn't read clearly is named under the form.

## If something goes wrong

| Message in the app | Fix |
| --- | --- |
| *the reading service didn't accept your sign-in* | The stack's **TenantId** or **ClientId** is wrong. Run step 3 again with the right values. |
| *the reading service is busy* | Either the API's 1-a-second limit was hit, or Bedrock's shared 50-a-minute limit was (DPM may be reading at the same time). Wait a moment and click again. |
| *AccessDeniedException … model* | Bedrock access for the account has changed. Check **Bedrock > Model catalog > Claude Haiku 4.5**. |
| *ValidationException … model identifier is invalid* | Check that **ModelId** is `au.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| The button does nothing, and the browser console shows **CORS** | **AllowedOrigin** must be exactly `https://marcusappdev.github.io`, with no slash and no `/ZD_Systems`. |
| Nothing works in AWS at all | The monthly spend limit was reached and the account is paused. See *Account and cost* above. |

- **Error details:** CloudShell:

  ```bash
  aws logs tail /aws/lambda/zd-reader-reader --region ap-southeast-2 --since 1h
  ```

- **To switch off:** set `AUTO_READ` to `false`. To remove everything, delete the **zd-reader** stack. **Not** dpm-reader.
- **When ZD moves to its own tenant:** run step 3 with the new TenantId and ClientId, or in ZD's own AWS account.
