require('dotenv').config(); // Load environment variables

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});


const mailOptions = {
    from: process.env.EMAIL_USER,
    to: "mkotelisimbo@gmail.com",
    subject: "Test Email",
    text: "This is a test email."
};

transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
        console.error("❌ Error sending test email:", err);
    } else {
        console.log("✅ Test email sent:", info.response);
    }
});
