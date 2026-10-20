import { expect, test } from '@playwright/test';

// Exercises the real browser, same-origin cookie session and API-backed pages.
test('a new customer can create an account and reach the helper search', async ({ page }) => {
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  const registerResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Test Customer');
  await page.getByLabel('Phone number').fill('+356 7900 0000');
  await page.getByLabel('Your locality').fill('Mosta');
  await page.getByLabel('I want to').selectOption('Customer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('Test-Pass-2026!');
  await page.getByRole('button', { name: 'Create account' }).click();

  const response = await registerResponse;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Hello, Test\./ })).toBeVisible();

  const session = await page.request.get('/api/session');
  expect(session.ok()).toBeTruthy();
  expect((await session.json()).user).toMatchObject({ email, role: 'Customer' });

  await page.getByRole('link', { name: 'Find local help' }).click();
  await expect(page).toHaveURL(/\/find$/);
  await expect(page.getByRole('heading', { name: 'Find a helper.' })).toBeVisible();
  await expect(page.getByLabel('Service')).toBeVisible();
});

test('fixture-backed UI journey: a customer can find a verified plumber for a ForMe request', async ({ page }) => {
  const categoryId = '4f971bed-29b0-4811-9a47-88941e4a4cb5';
  const workerId = 'a28c65e1-c0fd-4455-a170-055d4c33208f';
  const worker = {
    id: workerId, userId: '71d1eb13-ec8c-472d-8961-b9ce07ea75fc', displayName: 'Mara the Plumber',
    bio: 'Licensed local plumber', locality: 'Mosta', yearsExperience: 12, verificationStatus: 'Verified',
    availableNow: false, availabilityUpdatedAt: '2026-10-20T10:00:00Z', isDemo: false, hourlyRate: 35,
    pricingType: 'Hourly', categoryIds: [categoryId], modes: ['ForMe'], reviewCount: 0, averageRating: null,
    radiusKm: 15, offerings: [{ categoryId, modes: ['ForMe'], pricingType: 'Hourly', price: 35 }], availability: [], reviews: []
  };

  await page.route('**/api/session', route => route.fulfill({ json: { user: null, csrfToken: 'browser-fixture-token', demoEnabled: false } }));
  await page.route('**/api/catalog', route => route.fulfill({ json: [{ id: categoryId, slug: 'plumbing', name: 'Plumbing', description: 'Repairs and maintenance', icon: 'wrench', modes: ['ForMe'], requiresVerification: true, isActive: true }] }));
  await page.route('**/api/workers**', route => route.fulfill({ json: [worker] }));
  await page.route(`**/api/workers/${workerId}`, route => route.fulfill({ json: worker }));

  await page.goto(`/find?categoryId=${categoryId}&mode=ForMe`);
  await expect(page.getByLabel('Service')).toHaveValue(categoryId);
  await expect(page.getByLabel('How would you like help?')).toHaveValue('ForMe');
  await expect(page.getByRole('heading', { name: 'Mara the Plumber' })).toBeVisible();
  await expect(page.getByText('Verified')).toBeVisible();

  await page.getByRole('link', { name: 'View profile' }).click();
  await expect(page).toHaveURL(new RegExp(`/workers/${workerId}$`));
  await expect(page.getByRole('heading', { name: 'Mara the Plumber' })).toBeVisible();
  await page.getByRole('link', { name: 'Request this helper' }).click();
  await expect(page).toHaveURL(new RegExp(`/bookings/new\\?workerId=${workerId}$`));
  await expect(page.getByLabel('Helper')).toHaveValue(workerId);
  await page.locator('select[name="categoryId"]').selectOption(categoryId);
  await expect(page.locator('select[name="categoryId"]')).toHaveValue(categoryId);
  await expect(page.getByLabel('How would you like help?')).toHaveValue('ForMe');
  await expect(page.getByText('No payment is taken on Daqqa t’Id.')).toBeVisible();
});

test('customer request, worker acceptance, completion and review work across real sessions', async ({ page, browser }) => {
  const workerContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5080' });
  const workerPage = await workerContext.newPage();
  const origin = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5080';
  const emailSuffix = crypto.randomUUID();
  const customerEmail = `browser-customer-${emailSuffix}@example.test`;
  const workerEmail = `browser-worker-${emailSuffix}@example.test`;
  const password = 'Good-Password-2026';

  const sessionResponse = await workerPage.request.get(`${origin}/api/session`);
  expect(sessionResponse.ok()).toBeTruthy();
  const csrfToken = (await sessionResponse.json()).csrfToken as string;
  const headers = { 'X-CSRF-TOKEN': csrfToken };
  const catalogResponse = await workerPage.request.get(`${origin}/api/catalog`);
  expect(catalogResponse.ok()).toBeTruthy();
  const categories = await catalogResponse.json() as Array<{ id: string; name: string; modes: string[]; requiresVerification: boolean }>;
  const category = categories.find(item => !item.requiresVerification && item.modes.includes('ForMe'));
  expect(category, 'The test database needs a non-regulated ForMe category').toBeTruthy();

  const workerRegistration = await workerPage.request.post(`${origin}/api/auth/register`, {
    headers, data: { email: workerEmail, password, displayName: 'Browser Test Helper', phone: '+356 79000000', locality: 'Mosta', role: 'Worker' }
  });
  expect(workerRegistration.ok(), await workerRegistration.text()).toBeTruthy();
  const authenticatedWorker = await workerPage.request.get(`${origin}/api/session`);
  expect(authenticatedWorker.ok()).toBeTruthy();
  headers['X-CSRF-TOKEN'] = (await authenticatedWorker.json()).csrfToken;
  const profileResponse = await workerPage.request.put(`${origin}/api/worker/profile`, {
    headers, data: { displayName: 'Browser Test Helper', bio: 'Ready to help', locality: 'Mosta', yearsExperience: 5, radiusKm: 20, hourlyRate: 40, categoryIds: [category!.id], modes: ['ForMe'], pricingType: 'Hourly' }
  });
  expect(profileResponse.ok(), await profileResponse.text()).toBeTruthy();
  const workerId = (await profileResponse.json()).id as string;
  const availabilityResponse = await workerPage.request.put(`${origin}/api/worker/availability`, {
    headers, data: { availableNow: false, windows: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:59' })), exceptions: [] }
  });
  expect(availabilityResponse.ok(), await availabilityResponse.text()).toBeTruthy();

  const registration = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Browser Customer');
  await page.getByLabel('Phone number').fill('+356 79000001');
  await page.getByLabel('Your locality').fill('Mosta');
  await page.getByLabel('Email address').fill(customerEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  expect((await registration).ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/find?categoryId=${category!.id}&mode=ForMe`);
  await page.locator(`a[href="/workers/${workerId}"]`).click();
  await expect(page.getByRole('heading', { name: 'Browser Test Helper' })).toBeVisible();
  await page.getByRole('link', { name: 'Request this helper' }).click();
  await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption(category!.id);
  await page.getByLabel('Short title').fill('Help with a small home task');
  await page.getByLabel('What do they need to know?').fill('Please bring basic tools.');
  await page.getByLabel('Locality').fill('Mosta');
  await page.getByLabel('Service address').fill('17 Private Lane');
  const requestedDay = new Date(Date.now() + 48 * 60 * 60 * 1000);
  requestedDay.setUTCHours(10, 0, 0, 0);
  await page.getByLabel('Preferred date and time').fill(requestedDay.toISOString().slice(0, 16));
  const create = page.waitForResponse(response => response.url().endsWith('/api/bookings') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send request' }).click();
  const createResponse = await create;
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
  const bookingId = (await createResponse.json()).id as string;
  await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}$`));
  await expect(page.getByText('Waiting for helper', { exact: true })).toBeVisible();

  await workerPage.goto(`/bookings/${bookingId}`);
  await workerPage.getByRole('button', { name: 'Accept request' }).click();
  await expect(workerPage.getByText('Helper accepted', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  await page.getByLabel('Add a booking photo').setInputFiles({ name: 'task.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZtV8AAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByText('Photo added to this private booking.')).toBeVisible();
  await workerPage.reload();
  await expect(workerPage.getByRole('img', { name: 'Private booking photo 1' })).toBeVisible();
  await workerPage.getByRole('button', { name: 'Start service' }).click();
  await expect(workerPage.getByText('In progress', { exact: true })).toBeVisible();
  await workerPage.getByRole('button', { name: 'Mark complete' }).click();
  await expect(workerPage.getByText('Completed', { exact: true })).toBeVisible();
  await expect(workerPage.getByText('Simulated total', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByLabel('Your rating').selectOption('5');
  await page.getByLabel('Your review').fill('Helpful and on time.');
  const review = page.waitForResponse(response => response.url().endsWith(`/api/bookings/${bookingId}/review`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Share review' }).click();
  expect((await review).ok()).toBeTruthy();
  await expect(page.getByText('Thanks for sharing your review.')).toBeVisible();
  await workerContext.close();
});
