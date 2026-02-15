require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios'); // Importing axios ONCE here

const app = express();
app.use(cors());
app.use(express.json());

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
    pricePerTicket: 100 // R100.00
};

// --- ROUTE: START CHECKOUT ---
app.post('/create-checkout', async (req, res) => {
    const { email, quantity } = req.body;

    // 1. Calculate Total (in cents)
    const amountInCents = (quantity * 100) * 100; // R100.00 * quantity
    
    // 2. Prepare the Success URL
    // We encode the email to ensure special characters (like @) don't break the link
    const successUrl = `http://localhost:3000/payment-success?email=${encodeURIComponent(email)}&qty=${quantity}`;
    const failUrl = `http://localhost:5500/index.html`; // Go back home if they cancel

    try {
        const response = await axios.post(
            'https://payments.yoco.com/api/checkouts',
            {
                amount: amountInCents,
                currency: 'ZAR',
                // We provide ALL parameter names to ensure Yoco understands where to go
                redirectUrl: successUrl, 
                successUrl: successUrl,
                cancelUrl: failUrl,
                metadata: {
                    email: email,
                    product: 'Marital Grace Seminar'
                }
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

// --- ROUTE: HANDLE SUCCESSFUL PAYMENT ---
app.get('/payment-success', async (req, res) => {
    const { email, qty } = req.query;
    
    // 1. Generate Unique Reference
    const uniqueRef = "MG-" + uuidv4().split('-')[0].toUpperCase();

    try {
        // 2. Generate PDF
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, qty);
        
        // 3. Send Email
        const mailOptions = {
            from: `"Marital Grace Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            html: `<h2>Payment Successful!</h2><p>Thank you for booking. Please find your official tickets attached to this email.</p>`,
            attachments: [{ 
                filename: `Ticket-${uniqueRef}.pdf`, 
                content: pdfBuffer, 
                contentType: 'application/pdf' 
            }]
        };

        await transporter.sendMail(mailOptions);

        // 4. Show Success Message in Browser
        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #A83236;">Payment Successful!</h1>
                <p>Thank you for your payment.</p>
                <p>Your ticket (<strong>${uniqueRef}</strong>) has been emailed to <strong>${email}</strong>.</p>
                <p>Please check your inbox (and spam folder).</p>
                <br>
                <a href="http://localhost:5500/index.html" style="text-decoration: none; background: #333; color: white; padding: 10px 20px; border-radius: 5px;">Return to Home</a>
            </div>
        `);

    } catch (error) {
        console.error(error);
        res.send("Payment successful, but we failed to send the email. Please contact support.");
    }
});

// --- HELPER: PDF GENERATION ---
function generateTicketPDF(ref, email, qty) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Design
        doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke('#A83236');
        doc.font('Times-Bold').fontSize(24).fillColor('#A83236').text("MARITAL GRACE", 50, 50);
        doc.font('Helvetica').fontSize(10).fillColor('#333').text("COUPLES SEMINAR 2026", 50, 80);
        doc.moveTo(50, 100).lineTo(545, 100).strokeColor('#ddd').stroke();
        
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

app.listen(process.env.PORT || 3000, () => {
    console.log('Server running on port 3000');
});