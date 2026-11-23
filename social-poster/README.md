# LIMBO Post Desk

One place for the team to drop photos for the socials. Cassey approves each post, then it goes out to the **Limbo Council** accounts on **Facebook, Instagram, Threads and X** by itself.

## How it works

1. **Upload.** A team member signs in with their name and the team access code, adds up to 10 photos, writes the caption, ticks the platforms and sends it. Live character counters show each platform's limit.
2. **Approve.** Cassey signs in with the approver code and opens **Approvals**. She can edit the caption, add a different caption for one platform (for example a shorter one for X), untick platforms, then press **Approve and post now** or **Decline** (with an optional reason the team can see).
3. **Post.** The app posts to each chosen platform and shows a link to every live post. If one platform fails, the others still go out, and **Retry failed platforms** redoes only the failed ones. A post is never sent twice to the same platform.

Before approving, the app checks the things the platforms would reject: X takes at most 4 photos and 280 characters, Threads 500 characters, Instagram 2,200 characters, 30 hashtags, and photos between 4:5 (tall) and 1.91:1 (wide).

### Safety

- **Nothing posts without the approver.** Team members can upload and see statuses, but only the approver code can approve, edit or decline.
- **Practice mode is on by default** (`DRY_RUN=true`). Approving marks a post as done but sends nothing. Turn it off only when every account passes `npm run check`.
- Photos are re-saved as JPEGs with all hidden data removed (phone GPS location included), resized to at most 2048 px.
- Photos of posts that are waiting or declined are private. Approved photos get an unguessable public link, because Instagram and Threads download photos from the app.
- All sign-in keys live only in the server's `.env` file. Nobody should paste them into chat.

## Setup (Nari)

Needs Node 22.13 or newer. Data is kept in `data/` (SQLite database + photos).

```bash
cd social-poster
npm install
cp .env.example .env    # fill it in
npm run check           # tests each account, posts nothing
npm start
```

### Hosting

Instagram and Threads fetch the photos from this app, so it must be reachable on a public **https** address (`PUBLIC_BASE_URL`). Any small Node host works (a VPS, Railway, Render with a persistent disk, or the same machine as Kira behind a reverse proxy). Keep `data/` on persistent storage.

### Connecting the accounts

Each account owner does their own sign-in and puts the values in `.env` on the server.

**Facebook Page + Instagram** (one Meta app covers both)

1. At developers.facebook.com, create an app (type **Business**) and add the **Facebook Login for Business** and **Instagram** products.
2. The Limbo Council Instagram must be a Professional account linked to the Limbo Council Facebook Page.
3. In Graph API Explorer, select the app, then request: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Generate a user token, then exchange it for a long-lived one (Access Token Debugger > Extend).
4. Call `GET /me/accounts` with it. Copy the Page's `id` to `FB_PAGE_ID` and its `access_token` to `FB_PAGE_TOKEN` (a Page token from a long-lived user token does not expire).
5. Call `GET /{FB_PAGE_ID}?fields=instagram_business_account` and copy that id to `IG_USER_ID`.
6. While the Meta app is in Development mode it can only post for people with a role on the app, which is fine for LIMBO's own accounts. App Review is only needed for other people's accounts.

**Threads**

1. In the same or a new Meta app, add the **Threads API** use case with `threads_basic` and `threads_content_publish`.
2. Add the Limbo Council Threads account as a Threads tester and accept the invite in Threads (Settings > Account > Website permissions).
3. Generate a token in the app dashboard, exchange it for a long-lived token, and put it in `THREADS_TOKEN`. Put the account's id (`GET https://graph.threads.net/v1.0/me?fields=id`) in `THREADS_USER_ID`.
4. Long-lived Threads tokens last 60 days. The app renews it every day by itself, so it should not expire while the app is running.

**X**

1. At developer.x.com, sign in as the Limbo Council X account and create a project and app. Posting needs an API plan that allows creating posts (X charges for this).
2. In the app's **User authentication settings**, set permissions to **Read and Write**.
3. Under **Keys and tokens**, copy the API Key and Secret, then generate the Access Token and Secret (generate them *after* switching to Read and Write). Put the four values in `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.

Then run `npm run check`. Every line should say PASS. The approver can see the same check any time on the **Accounts** page.

## Tests

```bash
npm test
```

The tests never contact a real platform. They cover the approval rules, practice mode, the exact API calls for single photos and carousels on all four platforms, partial failures and retries, the pre-approval checks, photo cleanup, sign-in, and that waiting photos stay private.
