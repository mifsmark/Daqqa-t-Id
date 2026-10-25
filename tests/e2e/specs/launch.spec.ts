import { expect, test } from '@playwright/test';

test('public contact and support pages open directly and remain usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const response = await page.goto('/contact');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Contact Daqqa t’Id', exact: true })).toBeVisible();
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: 'WhatsApp: +356 9989 4619', exact: true })).toHaveAttribute('href', 'https://wa.me/35699894619');
  await expect(main.getByRole('link', { name: 'markanthonymifsud@yahoo.com', exact: true })).toHaveAttribute('href', 'mailto:markanthonymifsud@yahoo.com');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect((await page.reload())?.status()).toBe(200);
  const support = await page.goto('/support');
  expect(support?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Support a useful local service.', exact: true })).toBeVisible();
  await page.locator('footer').getByRole('link', { name: 'Contact', exact: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.goto('/forgot-password');
  await page.getByRole('link', { name: 'Get help with your account', exact: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
});

test('a worker completes the three-step profile on a phone and gets clear hours feedback', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#primary-navigation').getByRole('link', { name: 'Become a helper' }).click();
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
  await page.goto('/register?role=Worker');
  await page.getByLabel('Your name').fill('Pilot Browser Helper');
  await page.getByLabel('Phone number').fill('+356 79000000');
  await page.getByLabel('Your locality').fill('Mosta');
  await page.getByLabel('Email address').fill(`onboarding-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Password').fill('Good-Password-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/worker$/);
  const notifications = page.getByRole('button', { name: /^Notifications/ });
  await expect(notifications).toBeVisible();
  await notifications.click();
  await expect(page.getByRole('region', { name: 'Updates' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await notifications.click();
  await expect(page.getByLabel('Your display name')).toHaveValue('Pilot Browser Helper');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose at least one service and one way to help before continuing.')).toBeVisible();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Cleaning', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Get it done', exact: true }).check();
  await page.getByLabel('Hourly rate (€)').fill('20');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByLabel('Monday start time').fill('09:00');
  let profileWrites = 0;
  page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/worker/profile') profileWrites++;
  });
  await page.getByRole('button', { name: 'Save my profile & hours' }).click();
  await expect(page.getByText('Add both a start and end time for Monday, or clear both to take that day off.')).toBeVisible();
  expect(profileWrites, 'An incomplete schedule must be caught before saving any profile change').toBe(0);
  await page.getByLabel('Monday end time').fill('17:00');
  await page.getByRole('button', { name: 'Save my profile & hours' }).click();
  await expect(page.getByText('Your profile and usual hours have been saved.')).toBeVisible();
  const profile = await page.request.get('/api/worker/profile');
  expect(profile.ok()).toBeTruthy();
  const saved = await profile.json();
  expect(saved.offerings.some((item: { modes: string[]; pricingType: string; price: number }) => item.modes.includes('ForMe') && item.pricingType === 'Hourly' && item.price === 20)).toBeTruthy();
  expect(saved.availability).toContainEqual(expect.objectContaining({ dayOfWeek: 1, startTime: expect.stringMatching(/^09:00/), endTime: expect.stringMatching(/^17:00/) }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel('Your display name')).toHaveValue('Pilot Browser Helper');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('checkbox', { name: 'Cleaning', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Monday start time')).toHaveValue(/^09:00(?::00)?$/);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.evaluate(() => Object.defineProperty(navigator, 'share', {
    configurable: true, value: async () => { throw new DOMException('User cancelled', 'AbortError'); },
  }));
  await page.locator('.worker-share').getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText('We couldn’t share or copy this link. Try WhatsApp instead.')).toBeHidden();
  await page.evaluate(() => Object.defineProperty(navigator, 'share', {
    configurable: true, value: async () => { throw new Error('Sharing is unavailable'); },
  }));
  await page.locator('.worker-share').getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('We couldn’t share or copy this link. Try WhatsApp instead.');
  await expect(page.locator('.worker-share').getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa.me\/\?text=/);
  expect(pageErrors).toEqual([]);
});

test('guest booking keeps the selected helper through login and signup links without an external redirect', async ({ page, request }) => {
  let session = await (await request.get('/api/session')).json();
  const signup = await request.post('/api/auth/register', {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    data: { email: `return-helper-${crypto.randomUUID()}@example.test`, password: 'Good-Password-2026', displayName: 'Booking Return Helper', phone: '+356 79000002', locality: 'Mosta', role: 'Worker' },
  });
  expect(signup.ok()).toBeTruthy();
  session = await (await request.get('/api/session')).json();
  const catalog = await (await request.get('/api/catalog')).json();
  const category = catalog.find((item: { slug: string }) => item.slug === 'cleaning');
  const profile = await request.put('/api/worker/profile', {
    headers: { 'X-CSRF-TOKEN': session.csrfToken },
    data: { displayName: 'Booking Return Helper', bio: 'Fictional test helper', locality: 'Mosta', yearsExperience: 1, radiusKm: 10, hourlyRate: 20, categoryIds: [category.id], modes: ['ForMe'], pricingType: 'Hourly' },
  });
  expect(profile.ok()).toBeTruthy();
  const workerId = (await profile.json()).id as string;
  const destination = `/bookings/new?workerId=${workerId}`;
  await page.goto(destination);
  await expect(page.getByText('Sign in before sending your request')).toBeVisible();
  await page.getByRole('link', { name: 'Log in', exact: true }).last().click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name').fill('Returning Booking Customer');
  await page.getByLabel('Phone number').fill('+356 79000001');
  await page.getByLabel('Your locality').fill('Mosta');
  const email = `booking-return-${crypto.randomUUID()}@example.test`;
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('Good-Password-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(destination);
  await expect(page.getByLabel('Short title')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Helper', exact: true })).toHaveValue(workerId);
  const sessionResponse = await page.request.get('/api/session');
  const customerSession = await sessionResponse.json();
  await page.request.post('/api/auth/logout', { headers: { 'X-CSRF-TOKEN': customerSession.csrfToken }, data: {} });
  await page.goto('/login?returnTo=%2F%2Fevil.example');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('Good-Password-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
