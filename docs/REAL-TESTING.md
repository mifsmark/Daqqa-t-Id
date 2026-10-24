# Test the staging app

Open [Daqqa t’Id staging](https://daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev). This tests the actual app using fictional jobs and simulated payments. It is not the real-service launch. Use test profile names, fictional addresses and harmless images; do not upload identity documents or arrange real work here.

The updated demo is published as version `6ecaf39d-1f3f-4703-83d2-71f1518bcee3` (source tag `cf17bdd`). Both complete CI suites passed, including all five browser journeys on each backend. The latest automated results and publication status are in [PROGRESS.md](PROGRESS.md). A successful deployment or local test does not establish that the public site works. Record the manual results below as you test; the public HTTPS smoke is still pending the development workspace's network access.

## Two people, or two browser sessions

Use a normal browser for the helper and a separate browser/private window for the customer. Create two accounts with different test email addresses and private passwords. Keep the passwords yourself; do not send them in chat. Public registration creates only customer/helper accounts, never an administrator.

### Set up the helper

1. Choose **Become a helper**, then create the helper account.
2. Complete the three profile steps: choose a test display name and **Mosta**; select **Cleaning**, **Get it done**, **By the hour** and **€20**.
3. For tomorrow's weekday, enter **09:00–17:00**. Save the profile and hours. Leave **Available now** off for this scheduled test.
4. Reload and check that the service, price and hours remain saved. Copy the public profile link.

Check two useful corrections: Continue should explain a missing service/mode; an unfinished hours pair should ask for both times before saving. To agree a price later, explicitly select **I’ll agree a price first**. A zero hourly/fixed price means free help, not a request for a quote.

### Run one complete booking

1. In the customer browser, open the helper's profile and choose **Request this helper**. If signed out, use the login/signup link and check that the same helper is still selected afterwards.
2. Choose **Cleaning / Get it done**, title **Test cleaning request**, locality **Mosta**, a fictional address and **tomorrow at 10:00 Malta time** for one hour. Send the request. No card details are needed.
3. Helper: open the request in **My space** and choose **Accept request**.
4. Customer: reload the booking and choose **Confirm booking**. Check the displayed €20 simulated amount and the status **Confirmed**.
5. Add a harmless booking photo. The assigned helper should see it. Open its image URL in a signed-out browser: it should be unavailable. Photos are accepted after confirmation.
6. Helper: reload, choose **Start service**, then **Mark complete**. Customer: reload, submit a test rating/review and check that it appears once. The booking should show **Completed**.

Reload between the two people's actions if needed. The pilot does not currently send configured email/SMS alerts; a coordinator must explain when participants should check their dashboard. Password-reset email is unconfigured and should report that honestly.

## Record what happened

These are expected outcomes, not completed manual results. Mark the result after testing.

| Check | Expected result | Your result |
| --- | --- | --- |
| Mobile signup and three-step helper setup | Fields are usable; profile/hours survive reload | Not run |
| Missing service or incomplete time pair | Clear feedback before progressing/saving | Not run |
| Guest returns after login/signup | Same selected helper; external return links rejected | Not run |
| Request → accept → confirm → start → complete | Correct status and simulated amount at each step | Not run |
| Booking photo | Participant can read; signed-out browser cannot | Not run |
| Review | One review on the completed booking | Not run |
| Profile sharing | Valid profile/WhatsApp link; cancelling native share is harmless | Not run |

For a problem, record the action, helper/customer role, approximate time, page path, expected result and exact visible error. A screenshot is useful. Leave out passwords, cookies, tokens and private job details. Do not label a test successful if registration or any booking step fails.

## After the first successful test

Share the results with the owner, resolve blockers, then invite a few testers to repeat this checklist. The [launch kit](LAUNCH-KIT.md) contains demo invitations and separate real-pilot templates. Real-service promotion needs a checked production URL, owner/support contact, reviewed terms, a recovery/support process and real participating workers. Staging remains excluded from search engines, and its simulated commission is not income.
