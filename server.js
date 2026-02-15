require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (images, css) from the public folder
app.use(express.static('public'));

// --- 1. GOOGLE SHEETS CONFIGURATION ---
const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

async function saveAttendeeToSheet(data) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0]; 
        await sheet.addRow(data);
        console.log("✅ Guest list updated in Google Sheets");
    } catch (e) {
        console.error("❌ Google Sheets Error:", e.message);
    }
}

// --- 2. EVENT CONSTANTS ---
const EVENT_DETAILS = {
    name: "MARITAL GRACE",
    tagline: "THE KEY TO 32 YEARS OF MARRIAGE",
    date: "14.03.2026",
    time: "9:00am",
    location: "63 Langrand Road, Vereeniging, 1929",
    venue: "The Synagogues JWC",
    pricePerTicket: 100
};

// --- 3. ROUTES ---

// Serve the main website at /marital-grace
app.get('/marital-grace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Step 1: Create the Yoco Checkout Link
app.post('/create-checkout', async (req, res) => {
    const { email, quantity } = req.body;
    const amountInCents = (quantity * EVENT_DETAILS.pricePerTicket) * 100;

    // Determine current domain dynamically
    const host = req.get('host');
    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
    const domain = `${protocol}://${host}`;

    // Where to send user after payment
    const redirectUrl = `${domain}/marital-grace?payment_success=true&email=${encodeURIComponent(email)}&qty=${quantity}`;

    try {
        const response = await axios.post(
            'https://payments.yoco.com/api/checkouts',
            {
                amount: amountInCents,
                currency: 'ZAR',
                redirectUrl: redirectUrl,
                successUrl: redirectUrl,
                cancelUrl: `${domain}/marital-grace`,
                metadata: { email, quantity }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.YOCO_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        res.json({ redirectUrl: response.data.redirectUrl });
    } catch (error) {
        console.error("Yoco API Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Could not initiate payment." });
    }
});

// Step 2: Generate Ticket, Save to Sheet, and Email (Triggered after successful redirect)
app.post('/send-ticket', async (req, res) => {
    const { email, quantity } = req.body;
    
    if (!email) return res.status(400).json({ error: "Missing email" });

    const uniqueRef = "MG-" + uuidv4().split('-')[0].toUpperCase();

    try {
        // A. Log to Google Sheets
        await saveAttendeeToSheet({
            Timestamp: new Date().toLocaleString('en-ZA'),
            Email: email,
            Reference: uniqueRef,
            Quantity: quantity,
            Total: `R${quantity * EVENT_DETAILS.pricePerTicket}`
        });

        // B. Generate the PDF
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, quantity);
        const base64Pdf = pdfBuffer.toString('base64');

        // C. Send via Brevo API
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Marital Grace Team", email: process.env.FROM_EMAIL },
            to: [{ email: email }],
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            htmlContent: `
                <div style="font-family: sans-serif;">
                    <h2>Payment Successful!</h2>
                    <p>Thank you for booking your seat. Your reference number is <b>${uniqueRef}</b>.</p>
                    <p>Please find your official entry tickets attached to this email.</p>
                    <br>
                    <p>We look forward to seeing you at <b>The Synagogues JWC</b> on the 14th of March.</p>
                </div>
            `,
            attachment: [{ content: base64Pdf, name: `Ticket-${uniqueRef}.pdf` }]
        }, {
            headers: { 
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ Ticket ${uniqueRef} processed for ${email}`);
        res.json({ success: true, ref: uniqueRef });

    } catch (error) {
        console.error("Processing Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to complete ticket processing." });
    }
});

// --- 4. PDF GENERATOR (STUB DESIGN) ---
function generateTicketPDF(ref, email, qty) {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ size: [800, 250], margin: 0 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Background
        doc.rect(0, 0, 800, 250).fill('#F2EFE9'); 

        // Polaroid Image (expects image in public/media/)
        try {
            doc.image('public/media/1994.png', 25, 25, { width: 175 });
        } catch (e) {
            doc.rect(25, 25, 175, 200).stroke('#ccc');
        }

        // Header
        doc.fillColor('#000').font('Helvetica').fontSize(11).text('EVENT TICKET', 230, 40);
        doc.fillColor('#A83236').font('Times-BoldItalic').fontSize(48).text('MARITAL', 230, 60);
        doc.text('GRACE', 230, 105);
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(EVENT_DETAILS.tagline, 230, 160);

        // Information Grid
        doc.lineWidth(1);
        doc.rect(220, 180, 360, 50).stroke('#000');
        doc.moveTo(220, 205).lineTo(580, 205).stroke('#000'); // Horizontal line
        doc.moveTo(480, 180).lineTo(480, 230).stroke('#000'); // Vertical line

        doc.fontSize(10).font('Helvetica').fillColor('#000');
        doc.text(EVENT_DETAILS.venue, 230, 188);
        doc.text(EVENT_DETAILS.date, 490, 188);
        doc.text(EVENT_DETAILS.location, 230, 213);
        doc.text(EVENT_DETAILS.time, 490, 213);

        // Perforation Dotted Line
        for(let i = 10; i < 250; i+=15) {
            doc.circle(610, i, 3).fill('#000');
        }

        // Vertical Stub Text
        doc.save();
        doc.rotate(-90, { origin: [750, 125] });
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text(`TICKET NO: ${ref}  |  ADMIT: ${qty} PERSON(S)`, 630, 125);
        doc.restore();

        // Simulated Barcode
        for(let i = 0; i < 45; i++) {
            let barWidth = Math.random() * 2.5 + 0.5;
            doc.rect(660 + (i*2.8), 40, barWidth, 140).fill('#000');
        }

        doc.end();
    });
}

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Marital Grace server live on port ${PORT}`);
});