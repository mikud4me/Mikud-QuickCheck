import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { buildIdentityLock, computeMissingCritical, buildIdCardDetails } from '../../../shared/preScanRequirements.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { file_urls } = await req.json();

        if (!file_urls || !file_urls.length) {
            return Response.json({ error: 'file_urls is required' }, { status: 400 });
        }

        const scanPrompt = `
        You are a fast document classifier for an Israeli mortgage advisory firm.
        Your ONLY job: scan ALL uploaded documents and categorize what you find.
        Do NOT analyze income, calculate PTI, or make decisions. Just classify.
        Do NOT decide what is missing — that is computed deterministically from your
        classification afterward, not something you need to reason about.

        For each document type, check if it exists and count how many you see.

        DOCUMENT TYPES TO DETECT:
        1. id_card — תעודת זהות (front or back with photo/details)
        2. payslip — תלוש שכר (any employer)
        3. bank_statement — דף עובר ושב / תנועות בנק
        4. mortgage_balance — יתרת סילוק / פירוט משכנתא קיימת
        5. tax_assessment — שומת מס / הודעה על שומת מס (עצמאים)
        6. cpa_letter — מכתב רו"ח / אישור הכנסות עצמאי
        7. employment_letter — מכתב מעסיק / אישור העסקה / אישור שבתון / אישור חזרה לעבודה
        8. pension_slip — תלוש פנסיה / קצבת נכות
        9. property_doc — נסח טאבו / שמאות / הסכם רכישה
        10. other — anything else (specify what)

        FOR PAYSLIPS: note how many different people appear (by name or ID)
        FOR BANK STATEMENTS: note how many months are covered
        FOR MORTGAGE_BALANCE: note the bank name if visible

        ⚠️ CRITICAL LANGUAGE RULE: ALL text in "details", "scan_notes", and "borrower_names"
        MUST be written in HEBREW ONLY. Do NOT use any English words.

        ── IDENTITY LOCK EXTRACTION ──
        Extract the following identity fields for each borrower found:

        FROM ID CARDS (תעודת זהות):
        - full_name: exact name as printed
        - id_number: the 9-digit ID number (include leading zeros)
        - id_expiry_date: the expiry date in DD/MM/YYYY format (שדה "בתוקף עד" or "תוקף")
        - id_issue_date: issue date if visible

        🔒 CRITICAL — PRIMARY HOLDER vs. SPOUSE MENTIONED ON THE ספח (this is the single most
        common identity-scan mistake, do not get it wrong):
        An Israeli ת.ז. ספח (ID appendix page) lists the PRIMARY HOLDER at the top (their own
        name + ID number under "שם פרטי"/"שם משפחה"/"מספר זהות"), and separately may list a
        "בן זוג"/"בת זוג" (spouse) field further down with the spouse's name and ID number.
        These are NOT the same thing:
        - id_cards_found must contain ONLY the PRIMARY HOLDER — the person whose own scanned
          ID document this is. Do NOT add an entry to id_cards_found for a spouse who is merely
          named in the "בן זוג"/"בת זוג" field — that person has NOT provided their own ID
          document, even though their name and ID number are visible on this page.
        - If a spouse is named in the "בן זוג"/"בת זוג" field with a visible ID number, put them
          in spouse_mentioned_on_sepach instead (see schema below) — this correctly signals
          "we know who they are and their number, but they have not independently verified their
          own identity via their own document."
        - Example: an ID+ספח belonging to Yaakov shows "בן זוג: אורטל ארמה 032557852". Yaakov
          goes in id_cards_found (he is the primary holder). Ortal goes in
          spouse_mentioned_on_sepach (she is only mentioned, not independently verified) — never
          in id_cards_found.
        - When writing "details" for the found_documents entry describing this document, phrase
          it precisely: state whose ID card this is, and separately note that a spouse is named
          on the ספח with their own ID still required — never phrase it as if both people's ID
          documents were found/verified equally.
        - Also note whether the SAME ספח page additionally lists children (ילדים) of the
          primary holder, alongside the spouse — set children_also_listed=true on that
          spouse_mentioned_on_sepach entry if so. Children are never borrowers and never need
          their own ID document; this flag exists only so the missing-documents message can
          correctly describe what's on the page (e.g. "spouse mentioned alongside the children"
          vs. "spouse mentioned alone") without needing the children's own names/details.

        FROM PAYSLIPS (תלושי שכר):
        - employee_name: name on payslip
        - employee_id: ID number on payslip (include leading zeros)
        - employer: employer name

        FROM BANK STATEMENTS (דפי עובר ושב):
        - account_holder_name: account holder name if visible

        ALSO DETECT:
        - has_sabbatical_indicator: true if any document mentions שבתון or שנת שבתון
        - has_maternity_indicator: true if any document mentions חופשת לידה / דמי לידה / הריון
        - has_business_indicator: true if any document mentions עסק / עצמאי / מכירות / מחזור
        - estimated_total_pages: rough count of total pages
        - irrelevant_pages_estimate: pages that are clearly not financial documents
        - borrower_names: list of names you can identify from the documents
        `;

        const result = await base44.integrations.Core.InvokeLLM({
            prompt: scanPrompt,
            file_urls: file_urls,
            model: 'gemini_3_flash',
            response_json_schema: {
                type: "object",
                properties: {
                    found_documents: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: { type: "string" },
                                count: { type: "number" },
                                details: { type: "string" }
                            }
                        }
                    },
                    has_mortgage_balance: { type: "boolean" },
                    has_id_card: { type: "boolean" },
                    has_payslips: { type: "boolean" },
                    has_bank_statements: { type: "boolean" },
                    has_business_docs: { type: "boolean" },
                    has_sabbatical_indicator: { type: "boolean" },
                    has_maternity_indicator: { type: "boolean" },
                    has_business_indicator: { type: "boolean" },
                    num_borrowers_detected: { type: "number" },
                    borrower_names: { type: "array", items: { type: "string" } },
                    estimated_total_pages: { type: "number" },
                    irrelevant_pages_estimate: { type: "number" },
                    suggested_report_type: { type: "string" },
                    additional_suggested_types: { type: "array", items: { type: "string" } },
                    scan_notes: { type: "string" },
                    // ── Identity Lock fields ──
                    id_cards_found: {
                        type: "array",
                        description: "PRIMARY HOLDERS ONLY — people whose own ID card/ספח this document is. Do NOT include a spouse who is merely named in the ספח's 'בן זוג'/'בת זוג' field; put them in spouse_mentioned_on_sepach instead.",
                        items: {
                            type: "object",
                            properties: {
                                full_name: { type: "string" },
                                id_number: { type: "string" },
                                id_expiry_date: { type: "string" },
                                id_issue_date: { type: "string" }
                            }
                        }
                    },
                    spouse_mentioned_on_sepach: {
                        type: "array",
                        description: "People named in the 'בן זוג'/'בת זוג' field of someone else's ת.ז. ספח, with a visible ID number, who have NOT provided their own separate ID card/ספח. Known but not independently verified.",
                        items: {
                            type: "object",
                            properties: {
                                full_name: { type: "string" },
                                id_number: { type: "string" },
                                mentioned_on: { type: "string", description: "Full name of the primary ID-card holder whose ספח mentions this person" },
                                children_also_listed: { type: "boolean", description: "true if the same ספח page also lists children (ילדים) of the primary holder, alongside this spouse" }
                            }
                        }
                    },
                    payslip_identities: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                employee_name: { type: "string" },
                                employee_id: { type: "string" },
                                employer: { type: "string" }
                            }
                        }
                    },
                    bank_account_holders: {
                        type: "array",
                        items: { type: "string" }
                    }
                }
            }
        });

        // ── DETERMINISTIC IDENTITY LOCK ANALYSIS ──
        const identityLock = buildIdentityLock(result);
        result.identity_lock = identityLock;

        // ── DETERMINISTIC MISSING-DOCUMENTS CHECKLIST (no LLM) ──
        // The model is never asked what's missing — it only classifies what it sees.
        // "Missing" is a fixed rule applied to that classification, so the same set of
        // uploaded files always produces the same missing-documents list, run to run.
        result.missing_critical = computeMissingCritical(result, identityLock);
        delete identityLock._missingCriticalAdditions;

        // ── DETERMINISTIC id_card DETAILS TEXT (no LLM) ──
        // Overrides the model's free-text description for EVERY id_card entry with the same
        // sentence built from id_cards_found/spouse_mentioned_on_sepach — see buildIdCardDetails.
        // Uses forEach (not find) since the model can split one ID+ספח file's classification
        // into more than one found_documents entry of type id_card.
        const idCardDetails = buildIdCardDetails(result);
        if (idCardDetails && Array.isArray(result.found_documents)) {
            result.found_documents.filter(d => d.type === 'id_card').forEach(d => { d.details = idCardDetails; });
        }

        return Response.json(result);

    } catch (error) {
        console.error('preScanDocuments error:', error);
        const msg = error.message || '';
        if (msg.includes('The document has no pages') || msg.includes('no pages') || msg.includes('INVALID_ARGUMENT')) {
            return Response.json({
                error: 'אחד מהקבצים שהועלו פגום או ריק. יש לפתוח את הקובץ ידנית ולוודא שהוא תקין, ואז להעלות מחדש.',
                error_code: 'FILE_CORRUPTED'
            }, { status: 400 });
        }
        return Response.json({ error: msg || 'שגיאה לא ידועה בסריקה', error_code: 'UNKNOWN' }, { status: 500 });
    }
});
