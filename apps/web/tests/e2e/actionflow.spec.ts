import { test, expect } from '@playwright/test';

const API_BASE = 'https://actionflow-api.marketmesh-api.workers.dev';

test('ActionFlow health', async ({ page }) => {
  const res = await page.request.get(`${API_BASE}/api/health`);
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.status).toBe('ok');
});

test('ActionFlow samples', async ({ page }) => {
  const res = await page.request.get(`${API_BASE}/api/samples`);
  expect(res.ok()).toBeTruthy();
  const samples = await res.json();
  expect(samples.length).toBeGreaterThan(0);
});

test('ActionFlow extract from text', async ({ page }) => {
  const res = await page.request.post(`${API_BASE}/api/extract`, {
    data: {
      source_text: 'Interview on Friday, November 20 at 2:00pm EST. Please bring ID.',
      processing_consent: true,
      source_type: 'paste'
    }
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.request_id).toBeDefined();
  expect(data.actions.length).toBeGreaterThan(0);
});

test('ActionFlow full flow', async ({ page }) => {
  const res = await page.request.post(`${API_BASE}/api/extract`, {
    data: {
      source_text: 'Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am.',
      processing_consent: true,
      source_type: 'paste'
    }
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  
  const reqId = data.request_id;
  const actId = data.actions[0].id;
  
  const validate = await page.request.post(`${API_BASE}/api/validate`, {
    data: { request_id: reqId, action_id: actId, edits: { timezone: 'EST' } }
  });
  expect(validate.ok()).toBeTruthy();
  const validateData = await validate.json();
  expect(validateData.action.status).toBe('reviewed');
  
  const approve = await page.request.post(`${API_BASE}/api/approve`, {
    data: { request_id: reqId, action_ids: [actId] }
  });
  expect(approve.ok()).toBeTruthy();
  
  const exportRes = await page.request.post(`${API_BASE}/api/export`, {
    data: { request_id: reqId, action_ids: [actId], output_type: 'ics' }
  });
  expect(exportRes.ok()).toBeTruthy();
  const ics = await exportRes.text();
  expect(ics).toContain('BEGIN:VCALENDAR');
});
