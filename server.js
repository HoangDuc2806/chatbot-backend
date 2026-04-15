const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in .env");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Danh sách model fallback theo thứ tự ưu tiên
const MODEL_FALLBACKS = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.0-pro",
];

// Hàm gọi Gemini với retry + fallback model
async function generateWithFallback(message, retries = 2) {
  for (const modelName of MODEL_FALLBACKS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🤖 Trying model: ${modelName} (attempt ${attempt})`);

        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: message }] }],
        });

        const text = result.response.text();
        console.log(`✅ Success with model: ${modelName}`);
        return text;

      } catch (err) {
        const is503 = err.status === 503 || err.message?.includes("503");
        const isOverloaded = err.message?.includes("overloaded") || err.message?.includes("high demand");

        console.warn(`⚠️ Model ${modelName} attempt ${attempt} failed:`, err.message);

        if ((is503 || isOverloaded) && attempt < retries) {
          // Chờ 2 giây trước khi retry
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        // Nếu không phải lỗi 503/overloaded → không retry model này nữa
        if (!is503 && !isOverloaded) throw err;

        // Hết retry → thử model tiếp theo
        break;
      }
    }
  }

  throw new Error("Tất cả model đều không phản hồi được.");
}

app.get("/", (req, res) => {
  res.send("🚀 Gemini Chatbot Server is running!");
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Missing message" });
    }

    const text = await generateWithFallback(message);
    res.json({ reply: text });

  } catch (err) {
    console.error("🔥 Gemini Error:", err);

    const isOverloaded =
      err.status === 503 ||
      err.message?.includes("503") ||
      err.message?.includes("high demand") ||
      err.message?.includes("overloaded");

    if (isOverloaded) {
      return res.status(503).json({
        reply: "⏳ AI đang quá tải, vui lòng thử lại sau vài giây...",
        error: err.message,
      });
    }

    res.status(500).json({
      reply: "❌ Gemini gặp lỗi. Vui lòng thử lại!",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});