# Test the staging app

Open [Daqqa t’Id staging](https://daqqa-t-id-staging.daqqatid-75d7e2e4.workers.dev). This tests the actual app using fictional jobs and simulated payments. It is not the real-service launch. Use test profile names, fictional addresses and harmless images; do not upload identity documents or arrange real work here.

The current deployed version is `d20a882d-e972-496e-8fd8-543fbad2ba3f` (source `ad337e5`); its public HTTPS booking/notification/private-photo/review smoke passed. The current release, automated results and publication status are recorded in [PROGRESS.md](PROGRESS.md). Use the steps below to record your own phone and usability results; automated browser tests cannot establish that a real phone displayed an alert.

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
3. Helper: open the **bell** and check for the new request. Open it from the notification and choose **Accept request**. Customer: check that your bell shows the acceptance update.
4. Customer: choose **Confirm booking**. Check the displayed €20 simulated amount and the status **Confirmed**. Helper: check for the confirmation in your bell.
5. Add a harmless booking photo. The assigned helper should see it. Open its image URL in a signed-out browser: it should be unavailable. Photos are accepted after confirmation.
6. Helper: reload, choose **Start service**, then **Mark complete**. Customer: reload, submit a test rating/review and check that it appears once. The booking should show **Completed**.

The bell refreshes while the app is visible and when you return to it. To test phone alerts on each account, open the bell, choose **Turn on phone alerts**, allow the browser prompt and choose **Send a test alert**. Check receipt on the actual phone; a queued response alone is insufficient. On iPhone/iPad, add the app to the Home Screen and open that icon first. See [NOTIFICATIONS.md](NOTIFICATIONS.md). Email/SMS alerts and password-reset email remain unconfigured.

Open **Support the service** in the footer. The staging demo must explain that optional payments are not connected and must not present a real checkout. Browsing and booking must remain usable. Production setup is in [MONETIZATION.md](MONETIZATION.md).

## Record what happened

These are expected outcomes, not completed manual results. Mark the result after testing.

| Check | Expected result | Your result |
| --- | --- | --- |
| Mobile signup and three-step helper setup | Fields are usable; profile/hours survive reload | Not run |
| Missing service or incomplete time pair | Clear feedback before progressing/saving | Not run |
| Guest returns after login/signup | Same selected helper; external return links rejected | Not run |
| Request → accept → confirm → start → complete | Correct status and simulated amount at each step | Not run |
| Helper new-request/confirmation and customer status alerts | Correct recipient; bell opens the booking | Not run |
| Phone opt-in and test alert | No permission prompt before action; actual phone receipt checked | Not run |
| Optional support | Staging cannot charge; service remains usable | Not run |
| Booking photo | Participant can read; signed-out browser cannot | Not run |
| Review | One review on the completed booking | Not run |
| Profile sharing | Valid profile/WhatsApp link; cancelling native share is harmless | Not run |

For a problem, record the action, helper/customer role, approximate time, page path, expected result and exact visible error. A screenshot is useful. Leave out passwords, cookies, tokens and private job details. Do not label a test successful if registration or any booking step fails.

## After the first successful test

Share the results with the owner, resolve blockers, then invite a few testers to repeat this checklist. The [launch kit](LAUNCH-KIT.md) contains demo invitations and separate real-pilot templates. Real-service promotion needs a checked production URL, owner/support contact, reviewed terms, a recovery/support process and real participating workers. Staging remains excluded from search engines, and its simulated commission is not income.
