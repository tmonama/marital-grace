require('dotenv').config();
const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- TICKET DATABASE (In-Memory) ---
// Note: On Render Free, this list resets if the server sleeps/restarts.
let ticketSales = [];

const EVENT_DETAILS = {
    name: "MARITAL GRACE",
    tagline: "THE KEY TO 32 YEARS OF MARRIAGE",
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

// SECRET ADMIN ROUTE: View who bought tickets
app.get('/admin-dashboard', (req, res) => {
    let rows = ticketSales.map(t => `
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding:10px;">${t.date}</td>
            <td style="padding:10px;">${t.email}</td>
            <td style="padding:10px;"><strong>${t.ref}</strong></td>
            <td style="padding:10px;">${t.qty}</td>
        </tr>
    `).join('');

    res.send(`
        <div style="font-family:sans-serif; padding:40px; max-width:800px; margin:auto;">
            <h2>Marital Grace 2026 - Guest List</h2>
            <table style="width:100%; border-collapse:collapse; background:white; box-shadow:0 2px 10px rgba(0,0,0,0.1);">
                <thead style="background:#A83236; color:white;">
                    <tr>
                        <th style="padding:10px; text-align:left;">Date</th>
                        <th style="padding:10px; text-align:left;">Email</th>
                        <th style="padding:10px; text-align:left;">Reference</th>
                        <th style="padding:10px; text-align:left;">Qty</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="4" style="padding:20px; text-align:center;">No tickets sold yet.</td></tr>'}</tbody>
            </table>
            <p style="margin-top:20px; font-size:0.8rem; color:gray;">Total Tickets Sold: ${ticketSales.reduce((a, b) => a + Number(b.qty), 0)}</p>
        </div>
    `);
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
            redirectUrl: redirectUrl,
            metadata: { email, quantity }
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

    // Add to our table/list
    ticketSales.push({
        date: new Date().toLocaleDateString(),
        email: email,
        ref: uniqueRef,
        qty: quantity
    });

    try {
        const pdfBuffer = await generateTicketPDF(uniqueRef, email, quantity);
        const base64Pdf = pdfBuffer.toString('base64');

        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Marital Grace Team", email: process.env.FROM_EMAIL },
            to: [{ email: email }],
            subject: `Your Tickets: Marital Grace Seminar (Ref: ${uniqueRef})`,
            htmlContent: `<h2>Success!</h2><p>Your tickets for Marital Grace are attached.</p>`,
            attachment: [{ content: base64Pdf, name: `Ticket-${uniqueRef}.pdf` }]
        }, {
            headers: { 'api-key': process.env.BREVO_API_KEY }
        });

        res.json({ success: true, ref: uniqueRef });
    } catch (error) {
        res.status(500).json({ error: "Email failed" });
    }
});

// --- NEW PDF DESIGN (MATCHING YOUR IMAGE) ---
function generateTicketPDF(ref, email, qty) {
    return new Promise((resolve) => {
        // Ticket size: 800x250 (Long rectangular stub)
        const doc = new PDFDocument({ size: [800, 250], margin: 0 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // 1. Background Color (Cream)
        doc.rect(0, 0, 800, 250).fill('#F2EFE9');

        // 2. Polaroid Image Placeholder (Left side)
        // If you have the image in your public/media folder:
        try {
            doc.image('public/media/1994.png', 20, 25, { width: 180 });
        } catch (e) {
            doc.rect(20, 25, 180, 200).stroke('#ccc'); // Fallback box
        }

        // 3. Main Text Section
        doc.fillColor('#000').font('Helvetica').fontSize(12).text('EVENT TICKET', 230, 40);
        
        // Title (Red Brush Style approximation)
        doc.fillColor('#A83236').font('Times-BoldItalic').fontSize(45).text('MARITAL', 230, 65);
        doc.text('GRACE', 230, 110);
        
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('THE KEY TO 32 YEARS OF MARRIAGE', 230, 165);

        // 4. Details Table
        doc.lineWidth(1);
        doc.moveTo(220, 185).lineTo(580, 185).stroke('#000'); // Top line
        doc.moveTo(220, 215).lineTo(580, 215).stroke('#000'); // Middle line
        doc.moveTo(220, 245).lineTo(580, 245).stroke('#000'); // Bottom line
        doc.moveTo(500, 185).lineTo(500, 245).stroke('#000'); // Vertical divider

        doc.fontSize(11).font('Helvetica');
        doc.text(EVENT_DETAILS.venue, 230, 195);
        doc.text(EVENT_DETAILS.date, 510, 195);
        doc.text(EVENT_DETAILS.location, 230, 225);
        doc.text(EVENT_DETAILS.time, 510, 225);

        // 5. Vertical Dotted Line (Perforation)
        doc.circle(600, 0, 20).fill('#F9F7F2'); // Cutout effect
        doc.circle(600, 250, 20).fill('#F9F7F2'); 
        
        for(let i = 20; i < 230; i+=15) {
            doc.circle(600, i, 3).fill('#000');
        }

        // 6. Right Stub (Barcode Area)
        doc.save();
        doc.rotate(-90, { origin: [750, 125] });
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(`TICKET NUMBER:  ${ref}`, 640, 120);
        doc.restore();

        // Barcode lines (Simulated)
        for(let i = 0; i < 50; i++) {
            let w = Math.random() * 3;
            doc.rect(660 + (i*2.5), 40, w, 140).fill('#000');
        }

        doc.end();
    });
}

app.listen(process.env.PORT || 3000);