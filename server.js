const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();
const OpenAI = require('openai');

const app = express();
app.use(bodyParser.json());

// Log all incoming requests for debugging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// --- WhatsApp API Config ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = 'faisalabad_cafe_bot_trial'; // You can change this to any secret word

// --- Root Route for Verification ---
app.get('/', (req, res) => {
    res.send('Faisalabad Cafe Bot is LIVE! ☕');
});

// --- Webhook Verification (for Meta) ---
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// --- Main Webhook Handler ---
app.post('/webhook', async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value?.messages?.[0];

        if (message) {
            const customerPhone = message.from; // User's phone number
            const userText = message.text.body;

            console.log(`Received message from ${customerPhone}: ${userText}`);

            // 1. Process message with OpenAI to see if they are asking about cafes
            const searchTerms = await getSearchTerms(userText);

            if (searchTerms) {
                // 2. Fetch cafe info from ScrapingDog (Google Maps)
                const cafeInfo = await getCafeFromGoogleMaps(searchTerms);

                // 3. Send reply back to user
                await sendWhatsappMessage(customerPhone, cafeInfo);
            } else {
                // Default reply if it's just a general chat
                await sendWhatsappMessage(customerPhone, "Hi! I am the Faisalabad Cafe Bot. Ask me about any cafe name, or just say 'best cafes in Faisalabad' to get started ☕");
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.sendStatus(500);
    }
});

// --- Logic to extract search keyword from user text ---
async function getSearchTerms(text) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful assistant for a cafe bot in Faisalabad. If the user is asking for a cafe, restaurant, or coffee shop, reply ONLY with the search term. For example: 'Where is Gloria Jeans?' -> reply 'Gloria Jeans Faisalabad'. If they aren't asking for a place, reply 'NONE'." },
                { role: "user", content: text }
            ],
            max_tokens: 20
        });

        const result = response.choices[0].message.content.trim();
        return result === 'NONE' ? null : result;
    } catch (err) {
        console.error("OpenAI Error:", err);
        return text + " Faisalabad"; // Fallback
    }
}

// --- Logic to fetch data from ScrapingDog Google Maps API ---
async function getCafeFromGoogleMaps(query) {
    try {
        const apiKey = process.env.SCRAPINGDOG_API_KEY;
        const url = `https://api.scrapingdog.com/google_maps/search?api_key=${apiKey}&query=${encodeURIComponent(query)}`;

        const response = await axios.get(url);
        const places = response.data;

        if (places && places.length > 0) {
            const place = places[0]; // Take the first result
            return `📍 *${place.title}*\n\n⭐ Rating: ${place.rating || 'N/A'} (${place.reviews || 0} reviews)\n🏠 Address: ${place.address || 'N/A'}\n📞 Phone: ${place.phone || 'N/A'}\n⏰ Status: ${place.opening_status || 'N/A'}\n🗺️ Location: ${place.link || 'N/A'}`;
        } else {
            return "Sorry, I couldn't find any cafe with that name in Faisalabad. Try another one! ☕";
        }
    } catch (err) {
        console.error("ScrapingDog Error:", err);
        return "I'm having trouble fetching cafe details right now. Please try again later!";
    }
}

// --- Logic to send message via WhatsApp Cloud API ---
async function sendWhatsappMessage(to, text) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
            messaging_product: "whatsapp",
            to: to,
            text: { body: text }
        }, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
        });
    } catch (err) {
        console.error("WhatsApp Send Error:", err.response?.data || err.message);
    }
}

// Export the app for Vercel
module.exports = app;
