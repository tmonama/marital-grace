require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path'); // Required for file paths

const app = express();
app.use(cors());
app.use(express.json());

// 1. Serve Static Files (HTML, CSS, Images)
app.use(express.static('public'));

// --- CONFIGURATION ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const EVENT_DETAILS = {
    name: "Marital Grace Seminar 2026",
    date: "14 March 2026",
    time: "09:00 AM",
    location: "The Synagogues, Langrand Road, Vereeniging",
    pricePerTicket: 100
};

// --- ROUTES ---

// 2. Serve the Website at the specific path "/marital-grace"
app.get('/marital-grace', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. Payment Checkout Route
app.post('/create-checkout', async (req, res) => {
    const { email, quantity } = req.body;
    const amountInCents = (quantity * 100) * 100;

    // DETECT DOMAIN:
    // If running locally, use localhost. If on Render, use the real domain.
    const host = req.get('host'); 
    const protocol = req.protocol;
    const domain = `${protocol}://${host}`; 
    
    // Yoco needs to know where to send them back.
    // We send them back to the /marital-grace page with a success flag
    const redirectUrl = `${domain}/marital-grace?payment_success=true&email=${encodeURIComponent(email)}&qty=${quantity}`;
    const failUrl = `${domain}/marital-grace`;

    try {
        const response = await axios.post(
            'https://payments.yoco.com/api/checkouts',
            {
                amount: amountInCents,
                currency: 'ZAR',
                redirectUrl: redirectUrl,
                successUrl: redirectUrl, // Some Yoco versions use this
                cancelUrl: failUrl,
                metadata: { email, product: 'Marital Grace Seminar' }
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
        console.error("Yoco Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to create payment link" });
    }
});

// 4. Trigger Email (Called by frontend after successful redirect)
app.post('/send-ticket', async (req, res) => {
    const { email, quantity } = req.body;
    
    if (!email) return res.status(400).json({ error: "No email provided" });

    const uniqueRef = "MG-" + uuidv4().split('-')[0].toUpperCase();

    try {
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, quantity);
        
        const mailOptions = {
            from: `"Marital Grace Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            html: `<h2>Payment Successful!</h2><p>Thank you for booking. Please find your official tickets attached.</p>`,
            attachments: [{ filename: `Ticket-${uniqueRef}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        };

        await transporter.sendMail(mailOptions);
        console.log(`Ticket sent to ${email}`);
        res.json({ success: true, ref: uniqueRef });

    } catch (error) {
        console.error("Email Error:", error);
        res.status(500).json({ error: "Failed to send email" });
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