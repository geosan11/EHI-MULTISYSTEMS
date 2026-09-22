import express from 'express';
import { GoogleGenAI, Type } from "@google/genai";

const router = express.Router();

// Initialize GoogleGenAI client (lazy/safely checked). Exported so
// server/aiChat.ts (AI Chat Buddy) reuses the same client setup instead of
// duplicating it.
export const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("warning: GEMINI_API_KEY environment variable is not set.");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

router.post('/insights', async (req, res) => {
  try {
    const { cargoRevenue, marketingRevenue, vjRevenue, topRoute, totalDebt, cargoCount, marketingCount } = req.body;
    
    const ai = getAiClient();
    if (!ai) {
      return res.status(200).json({
        success: false,
        error: "AI service config missing"
      });
    }

    const prompt = `
You are a logistics business analyst for EHI Multisystems Nigeria Limited.
Analyze this data and provide 3 concise business insights (2 sentences each):

Today's Data:
- Cargo Revenue: ₦${(cargoRevenue || 0).toLocaleString()}
- Marketing Revenue: ₦${(marketingRevenue || 0).toLocaleString()}
- Excess Baggage Revenue: ₦${(vjRevenue || 0).toLocaleString()}
- Top Route: ${topRoute || 'N/A'}
- Total Debt: ₦${(totalDebt || 0).toLocaleString()}
- Cargo Entries: ${cargoCount || 0}
- Marketing Entries: ${marketingCount || 0}

Provide insights about:
1. Revenue performance compared with other streams
2. Route or stream requiring business focus or expansion
3. One actionable recommendation for operational efficiency tomorrow

Format precisely as a JSON array: [{"title": "...", "insight": "...", "priority": "high" | "medium" | "low"}]
Return ONLY valid JSON. Absolutely do not include markdown blocks or "json" header/backticks. Just the raw array.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              insight: { type: Type.STRING },
              priority: { type: Type.STRING, description: "high, medium, or low" }
            },
            required: ["title", "insight", "priority"]
          }
        }
      }
    });

    const text = response.text || "[]";
    const parsed = JSON.parse(text.trim());
    res.json({ success: true, insights: parsed });
  } catch (error: any) {
    if (error?.message?.includes('429') || error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED') {
      console.warn("Gemini insights quota exceeded.");
      return res.json({
        success: false,
        error: "AI service quota exceeded. Please try again later."
      });
    }
    console.error("Gemini insights error:", error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/report-narrative', async (req, res) => {
  try {
    const { reportType, reportData } = req.body;
    
    const ai = getAiClient();
    if (!ai) {
      return res.status(200).json({
        success: false,
        error: "AI service config missing"
      });
    }

    const prompt = `
You are a logistics finance and operations auditor for EHI Multisystems Nigeria Limited.
Generate a professional, detailed 3-paragraph executive summary based on this report metadata:

Report Scope: ${reportType}
Report Data / Content Summary:
${JSON.stringify(reportData, null, 2)}

Provide your analysis in exactly 3 short paragraphs:
Paragraph 1: Performance overview (summarize the core numbers in an executive style).
Paragraph 2: Notable operational trends, high performers, or critical concerns (e.g., debt aging, route distribution limits).
Paragraph 3: Short-term tactical and strategic recommendations or next-step actions for management.

Write in a formal corporate tone. Return ONLY the 3 plain-text paragraphs.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    res.json({ success: true, narrative: response.text });
  } catch (error: any) {
    if (error?.message?.includes('429') || error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED') {
      console.warn("Gemini narrative quota exceeded.");
      return res.json({ 
        success: false, 
        error: "AI service quota exceeded. Please try again later."
      });
    }
    console.error("Gemini report narrative error:", error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/parse-pdf', async (req, res) => {
  try {
    const { pdfBase64 } = req.body;
    
    if (!pdfBase64) {
       return res.status(400).json({ success: false, error: "No PDF provided" });
    }

    const ai = getAiClient();
    if (!ai) {
      return res.status(200).json({
        success: false,
        error: "AI service config missing"
      });
    }

    // Prepare Document part from base64
    const documentPart = {
      inlineData: {
        data: pdfBase64,
        mimeType: 'application/pdf',
      },
    };

    const prompt = `You are parsing a Nigerian bank statement PDF. Extract all credit transactions only (where money came in). Return a JSON array with this structure per transaction: [{"date": "YYYY-MM-DD", "description": "string", "credit": number, "reference": "string"}]. Ignore debit rows. Dates should be YYYY-MM-DD. Amounts should be plain numbers without commas or currency symbols. Do not wrap the JSON in markdown blocks.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [documentPart, prompt],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              description: { type: Type.STRING },
              credit: { type: Type.NUMBER },
              reference: { type: Type.STRING }
            },
            required: ["date", "description", "credit", "reference"]
          }
        }
      }
    });

    const text = response.text || "[]";
    const parsed = JSON.parse(text.trim());
    res.json({ success: true, transactions: parsed });
  } catch (error: any) {
    console.error("Gemini parse-pdf error:", error);
    res.json({ success: false, error: error.message });
  }
});

export default router;
