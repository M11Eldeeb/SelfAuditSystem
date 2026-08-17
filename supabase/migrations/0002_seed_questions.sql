-- Seeds the questionnaire from audit_questions_schema.json.
-- compliant_options/partial_credit_options drive branch scoring (see src/lib/scoring.ts).

insert into audit_questions
  (id, sort_order, text, help_text, type, options, conditional_field, required, ai_checkable, ai_check_note, compliant_options, partial_credit_options)
values
  ('q1', 1, 'Customer concern clearly documented on the job card', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q2', 2, 'Customer''s signature obtained', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q3', 3, 'Customer concern clearly mentioned in the Repair Agreement', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q4', 4, 'New WIP created including the customer concern for pending "Out Vehicle" cases',
    'If the vehicle has not yet exited the service center, select "no need to open new WIP"', 'single_select',
    '["Yes","No","No need to open new WIP"]', null, true, false, null,
    '["Yes","No need to open new WIP"]', '[]'),

  ('q5', 5, 'Campaigns loaded in the job card', null, 'single_select',
    '["Yes","Not loaded","No campaigns available"]', null, true, true,
    'Cross-check against campaign eligibility data for the claim''s vehicle if available',
    '["Yes","No campaigns available"]', '[]'),

  ('q6', 6, 'Mileage on the job card is correct', null, 'single_select',
    '["Yes","No"]', null, true, true,
    'Cross-check against mileage field in the uploaded claims data', '["Yes"]', '[]'),

  ('q7', 7, 'Technician clocking (on/off) recorded accurately', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q8', 8, 'Repair evidence meets the right criteria', null, 'single_select',
    '["Yes","No","Partially"]', null, true, false, null, '["Yes"]', '["Partially"]'),

  ('q9', 9, 'Parts requisition form signed and documented with job card (if needed)', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q10', 10, 'Technical write-up (Customer Complaint) completed according to standards', null, 'single_select',
    '["Yes","No"]', null, true, true,
    'AI can read the write-up text/photo and judge against standards wording', '["Yes"]', '[]'),

  ('q11', 11, 'Technical write-up (Cause of Defect) completed according to standards', null, 'single_select',
    '["Yes","No"]', null, true, true, 'Same as q10', '["Yes"]', '[]'),

  ('q12', 12, 'Technical write-up (Correction) completed according to standards', null, 'single_select',
    '["Yes","No"]', null, true, true, 'Same as q10', '["Yes"]', '[]'),

  ('q13', 13, 'Technician''s name, signature and end of repair date clearly written on the back of the job card',
    null, 'single_select', '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q14', 14, 'Warranty claim submitted with accurate and complete supporting evidence',
    'All required files submitted in GWS, named and completed', 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q15', 15, 'Part''s serial number / production date verification', null, 'single_select',
    '["Yes","No"]', null, true, true,
    'Cross-check against part serial/production date in claims data if present', '["Yes"]', '[]'),

  ('q16', 16, 'Defective parts tagged', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q17', 17, 'Defective part stored and organized correctly within the warranty room', null, 'single_select',
    '["Yes","No"]', null, true, false, null, '["Yes"]', '[]'),

  ('q18', 18, 'Submission lead time (from end of repair date to dealer submit) < 5 days', null, 'single_select',
    '["Yes","Other"]',
    '{"shows_when_option":"Other","field_type":"number","field_label":"Actual number of days"}',
    true, true,
    'Directly computable from claim''s repair-end date and submission date in claims data',
    '["Yes"]', '[]');

insert into audit_photo_types (id, sort_order, label, help_text, required)
values
  ('photo_job_card_front', 1, 'Job Card (front side)', 'The attached copy should be clear', true),
  ('photo_job_card_back', 2, 'Job Card (back side)',
    'The attached copy should be clear. Should show technician''s name, signature, and end of repair date (q13)', true),
  ('photo_repair_agreement', 3, 'Repair Agreement', 'The attached copy should be clear', true),
  ('photo_parts_requisition', 4, 'Parts Requisition', 'The attached copy should be clear', true);
