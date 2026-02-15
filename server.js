require('dotenv').config();
const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- GOOGLE SHEETS SETUP ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Fixes newline issues in env vars
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function addToSheet(data) {
    try {
        await doc.loadInfo(); 
        const sheet = doc.sheetsByIndex[0]; // Uses the first tab
        await sheet.addRow(data);
        console.log("✅ Added to Google Sheets");
    } catch (e) {
        console.error("❌ Google Sheets Error:", e);
    }
}

const EVENT_DETAILS = {
    name: "MARITAL GRACE",
    date: "14.03.2026",
    time: "9:00am",
    location: "63 Langrand Road, Vereeniging, 1929",
    venue: "The Synagogues JWC",
    price: "R100,00"
};

// --- ROUTES ---

app.get('/marital-grace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/create-checkout', async (req, res) => {
    const { email, quantity } = req.body;
    const amountInCents = (quantity * 100) * 100;
    const host = req.get('host'); 
    const protocol = req.protocol;
    const domain = `${protocol}://${host}`; 
    const redirectUrl = `${domain}/marital-grace?payment_success=true&email=${encodeURIComponent(email)}&qty=${quantity}`;

    try {
        const response = await axios.post('https://payments.yoco.com/api/checkouts', {
            amount: amountInCents,
            currency: 'ZAR',
            redirectUrl: redirectUrl
        }, {
            headers: { 'Authorization': `Bearer ${process.env.YOCO_SECRET_KEY}` }
        });
        res.json({ redirectUrl: response.data.redirectUrl });
    } catch (error) {
        res.status(500).json({ error: "Checkout failed" });
    }
});

app.post('/send-ticket', async (req, res) => {
    const { email, quantity } = req.body;
    const uniqueRef = "MG-" + uuidv4().split('-')[0].toUpperCase();

    try {
        // 1. ADD TO GOOGLE SHEET
        await addToSheet({
            Date: new Date().toLocaleString('en-ZA'),
            Email: email,
            Reference: uniqueRef,
            Quantity: quantity,
            Status: 'Paid'
        });

        // 2. GENERATE PDF
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, quantity);
        const base64Pdf = pdfBuffer.toString('base64');

        // 3. SEND EMAIL (Brevo API)
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Marital Grace Team", email: process.env.FROM_EMAIL },
            to: [{ email: email }],
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            htmlContent: `<h2>Success!</h2><p>Find your tickets attached for reference <b>${uniqueRef}</b>.</p>`,
            attachment: [{ content: base64Pdf, name: `Ticket-${uniqueRef}.pdf` }]
        }, {
            headers: { 'api-key': process.env.BREVO_API_KEY }
        });

        res.json({ success: true, ref: uniqueRef });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Process failed" });
    }
});

// --- PDF GENERATOR (STUB DESIGN) ---
function generateTicketPDF(ref, email, qty) {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ size: [800, 250], margin: 0 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        doc.rect(0, 0, 800, 250).fill('#F2EFE9'); // Cream
        
        try {
            doc.image('public/media/1994.png', 25, 25, { width: 170 });
        } catch (e) {
            doc.rect(25, 25, 170, 200).stroke('#ccc');
        }

        doc.fillColor('#000').font('Helvetica').fontSize(11).text('EVENT TICKET', 230, 40);
        doc.fillColor('#A83236').font('Times-BoldItalic').fontSize(48).text('MARITAL', 230, 60);
        doc.text('GRACE', 230, 105);
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('THE KEY TO 32 YEARS OF MARRIAGE', 230, 160);

        // Table
        doc.rect(220, 180, 360, 50).stroke('#000');
        doc.moveTo(220, 205).lineTo(580, 205).stroke('#000');
        doc.moveTo(480, 180).lineTo(480, 230).stroke('#000');

        doc.fontSize(10).font('Helvetica');
        doc.text(EVENT_DETAILS.venue, 230, 188);
        doc.text(EVENT_DETAILS.date, 490, 188);
        doc.text(EVENT_DETAILS.location, 230, 213);
        doc.text(EVENT_DETAILS.time, 490, 213);

        // Perforation
        for(let i = 10; i < 250; i+=15) { doc.circle(610, i, 3).fill('#000'); }

        // Stub
        doc.save();
        doc.rotate(-90, { origin: [750, 125] });
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text(`REF: ${ref} | ADMIT: ${qty}`, 640, 125);
        doc.restore();

        // Barcode
        for(let i = 0; i < 40; i++) {
            doc.rect(670 + (i*3), 40, Math.random()*2.5, 140).fill('#000');
        }

        doc.end();
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT);