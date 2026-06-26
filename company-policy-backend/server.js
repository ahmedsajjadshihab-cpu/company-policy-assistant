import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
console.log("API Key:", process.env.OPENAI_API_KEY);

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    const response = await client.responses.create({
      model: "gpt-5",
      input: question,
    });

    res.json({
      answer: response.output_text,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});