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

// Serve static files from the public folder
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
        console.log("✅ Google Sheet Updated successfully");
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
    location: "Langrand Road, Vereeniging, 1929",
    venue: "The Synagogues JWC",
    pricePerTicket: 250
};

// --- 3. ROUTES ---

app.get('/marital-grace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Step 1: Create Yoco Checkout
app.post('/create-checkout', async (req, res) => {
    const { email, quantity, firstName, lastName } = req.body;
    const amountInCents = (quantity * EVENT_DETAILS.pricePerTicket) * 100;

    const host = req.get('host');
    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
    const domain = `${protocol}://${host}`;

    const redirectUrl = `${domain}/marital-grace?payment_success=true&email=${encodeURIComponent(email)}&qty=${quantity}&firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}`;

    try {
        const response = await axios.post(
            'https://payments.yoco.com/api/checkouts',
            {
                amount: amountInCents,
                currency: 'ZAR',
                redirectUrl: redirectUrl,
                successUrl: redirectUrl,
                cancelUrl: `${domain}/marital-grace`,
                metadata: { email, firstName, lastName }
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

// Step 2: Finalize Ticket (Save to Sheet & Email)
app.post('/send-ticket', async (req, res) => {
    const { email, quantity, firstName, lastName } = req.body;
    
    if (!email) return res.status(400).json({ error: "Missing email" });

    const uniqueRef = "MG-" + uuidv4().split('-')[0].toUpperCase();

    try {
        // A. Log to Google Sheets
        await saveAttendeeToSheet({
            Date: new Date().toLocaleString('en-ZA'),
            Name: `${firstName} ${lastName}`,
            Email: email,
            Reference: uniqueRef,
            Quantity: quantity,
            Status: "Paid"
        });

        // B. Generate PDF
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, quantity, firstName, lastName);
        const base64Pdf = pdfBuffer.toString('base64');

        // C. Send Email via Brevo API with Terms & Conditions
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Marital Grace Team", email: process.env.FROM_EMAIL },
            to: [{ email: email }],
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            htmlContent: `
                <div style="font-family: sans-serif; color: #333; line-height: 1.6;">
                    <h2 style="color: #A83236;">Payment Successful!</h2>
                    <p>Hi ${firstName}, your tickets are confirmed. Your reference number is <b>${uniqueRef}</b>.</p>
                    <p>Please find your official entry tickets attached to this email. You can present them at the door on your mobile device or as a printout.</p>
                    
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-top: 25px; border: 1px solid #eee;">
                        <h4 style="margin-top: 0; color: #000; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Terms & Conditions:</h4>
                        <ul style="font-size: 13px; color: #555; padding-left: 20px;">
                            <li>Valid only for Mar 14, 2026, 9AM at The Synagogues JWC. Entry requires a valid ticket (printed or digital).</li>
                            <li>No refunds. Transfers allowed if requested in writing at least 48 hours prior.</li>
                            <li>Doors open 8AM. Latecomers may experience delayed seating.</li>
                            <li>By attending, you consent to event photography/video for promotional use. Personal photos allowed; pro gear needs permission.</li>
                            <li>Please maintain respect for the event’s spiritual and relational purpose. Disruptive behavior may result in removal without refund.</li>
                            <li>Adults only unless otherwise stated.</li>
                            <li>The hosts are not responsible for injury, loss, or personal items.</li>
                        </ul>
                    </div>
                    
                    <p style="margin-top: 20px;">We look forward to seeing you at <b>The Synagogues JWC</b> on the 14th of March.</p>
                </div>
            `,
            attachment: [{ content: base64Pdf, name: `Ticket-${uniqueRef}.pdf` }]
        }, {
            headers: { 
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.json({ success: true, ref: uniqueRef });

    } catch (error) {
        console.error("Processing Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to process ticket." });
    }
});

// --- 4. PDF GENERATOR ---
function generateTicketPDF(ref, email, qty, firstName, lastName) {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ size: [800, 250], margin: 0 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        doc.rect(0, 0, 800, 250).fill('#F2EFE9'); 

        try {
            doc.image('public/media/1994.png', 20, 25, { width: 170 });
        } catch (e) {
            doc.rect(20, 25, 170, 200).stroke('#ccc');
        }

        doc.fillColor('#000').font('Helvetica').fontSize(11).text('EVENT TICKET', 230, 35);
        doc.fillColor('#A83236').font('Times-BoldItalic').fontSize(48).text('MARITAL', 230, 55);
        doc.text('GRACE', 230, 100);
        
        doc.fillColor('#000').font('Helvetica').fontSize(9).text(EVENT_DETAILS.tagline, 230, 150);
        doc.fillColor('#A83236').font('Helvetica-Bold').fontSize(16).text(`${firstName.toUpperCase()} ${lastName.toUpperCase()}`, 230, 168);

        doc.lineWidth(1);
        doc.rect(220, 195, 360, 45).stroke('#000');
        doc.moveTo(220, 217).lineTo(580, 217).stroke('#000'); 
        doc.moveTo(480, 195).lineTo(480, 240).stroke('#000'); 

        doc.fontSize(9).font('Helvetica').fillColor('#000');
        doc.text(EVENT_DETAILS.venue, 230, 202);
        doc.text(EVENT_DETAILS.date, 490, 202);
        doc.text(EVENT_DETAILS.location, 230, 224);
        doc.text(EVENT_DETAILS.time, 490, 224);

        for(let i = 10; i < 250; i+=15) {
            doc.circle(610, i, 3).fill('#000');
        }

        doc.save();
        doc.rotate(-90, { origin: [720, 125] });
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(`TICKET NO: ${ref}`, 600, 105);
        doc.fillColor('#555').font('Helvetica').fontSize(12).text(`ADMIT: ${qty} PERSON(S)`, 600, 130);
        doc.restore();

        doc.end();
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server live on port ${PORT}`);
});