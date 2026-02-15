require('dotenv').config();
const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios'); // We use this for the API call
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- CONFIGURATION ---
const EVENT_DETAILS = {
    name: "Marital Grace Seminar 2026",
    date: "14 March 2026",
    time: "09:00 AM",
    location: "The Synagogues, Langrand Road, Vereeniging",
    pricePerTicket: 100
};

// --- ROUTE: SEND TICKET (Using Brevo API) ---
app.post('/send-ticket', async (req, res) => {
    const { email, quantity } = req.body;
    
    if (!email) return res.status(400).json({ error: "No email provided" });

    const uniqueRef = "MG-" + uuidv4().split('-')[0].toUpperCase();

    try {
        // 1. Generate PDF Buffer
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, quantity);
        
        // 2. Convert PDF to Base64 (Brevo API requires this)
        const base64Pdf = pdfBuffer.toString('base64');

        // 3. Construct Brevo API Payload
        const emailData = {
            sender: { name: "Marital Grace Team", email: process.env.FROM_EMAIL },
            to: [{ email: email }],
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            htmlContent: `
                <h2>Payment Successful!</h2>
                <p>Thank you for booking. Your reference is <strong>${uniqueRef}</strong>.</p>
                <p>Please find your official tickets attached to this email.</p>
                <br>
                <p>See you on the 14th of March!</p>
            `,
            attachment: [
                {
                    content: base64Pdf,
                    name: `Ticket-${uniqueRef}.pdf`
                }
            ]
        };

        // 4. Send via Axios to Brevo API
        await axios.post('https://api.brevo.com/v3/smtp/email', emailData, {
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ Ticket sent via API to ${email}`);
        res.json({ success: true, ref: uniqueRef });

    } catch (error) {
        // Detailed error logging
        console.error("❌ Brevo API Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Failed to send email via API" });
    }
});

// --- PDF GENERATOR ---
function generateTicketPDF(ref, email, qty) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke('#A83236');
        doc.font('Times-Bold').fontSize(24).fillColor('#A83236').text("MARITAL GRACE", 50, 50);
        doc.font('Helvetica').fontSize(10).fillColor('#333').text("COUPLES SEMINAR 2026", 50, 80);
        
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text("Event Details", 50, 120);
        doc.font('Helvetica').fontSize(12).fillColor('#555');
        doc.text(`Date: ${EVENT_DETAILS.date}`, 50, 145);
        doc.text(`Time: ${EVENT_DETAILS.time}`, 50, 165);
        doc.text(`Venue: ${EVENT_DETAILS.location}`, 50, 185);

        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text("Ticket Information", 350, 120);
        doc.font('Helvetica').fontSize(12).fillColor('#555');
        doc.text(`Admit: ${qty} Person(s)`, 350, 145);
        doc.text(`Paid: R${qty * EVENT_DETAILS.pricePerTicket}`, 350, 165);
        
        doc.rect(340, 200, 200, 60).fillAndStroke('#f9f9f9', '#A83236');
        doc.fillColor('#A83236').fontSize(10).text("BOOKING REFERENCE", 350, 210);
        doc.fillColor('#000').fontSize(18).font('Courier-Bold').text(ref, 350, 230);
        
        doc.end();
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});