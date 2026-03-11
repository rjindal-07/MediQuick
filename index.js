const express = require('express');
const session = require('express-session');
const mysql = require('mysql2');
const path = require('path');

const app = express();
require('dotenv').config();
// --- MYSQL CONNECTION POOL ---
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD, 
    database: 'mediquick_health',
    waitForConnections: true,
    connectionLimit: 10
}).promise();

app.set('view engine', 'ejs'); 
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

app.use(session({
    secret: 'mediquick-mysql-secret',
    resave: false,
    saveUninitialized: true
}));

// Shared chemists database
const chemists = [
    { id: "c1", name: "Apollo Pharmacy", area: "Sector 1", username: "apollo_chemist", password: "Chemist@123", inventory: [{ name: "Augmentin", price: 210, requiresRx: true }, { name: "Vicks", price: 35, requiresRx: false }] },
    { id: "c2", name: "Wellness Forever", area: "Sector 2", username: "wellness_chemist", password: "Secure#Chemist1", inventory: [{ name: "Panadol", price: 45, requiresRx: false }, { name: "Metformin", price: 150, requiresRx: true }] }
];

app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

// --- AUTHENTICATION ---
app.get('/', (req, res) => res.render('index', { user: req.session.user, chemists }));

app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
        res.send("<h1>Signup Success!</h1><a href='/'>Login Now</a>");
    } catch (err) {
        res.send("<h1>User already exists or DB error</h1><a href='/'>Back</a>");
    }
});

app.post('/login', async (req, res) => {
    const { username, password, role } = req.body;

    if (role === 'chemist') {
        const chemist = chemists.find(c => c.username === username && c.password === password);
        if (chemist) {
            req.session.user = { username: chemist.username, role: 'chemist' };
            return res.redirect('/track');
        }
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
    if (rows.length > 0) {
        req.session.user = rows[0];
        res.redirect('/');
    } else {
        res.send("Login Failed! <a href='/'>Try Again</a>");
    }
});

// --- CART MANAGEMENT ---
app.post('/add-to-cart', (req, res) => {
    if (!req.session.cart) req.session.cart = [];
    const { medicineName, price, chemistId } = req.body;
    const existing = req.session.cart.find(i => i.medicineName === medicineName);
    if (existing) {
        existing.qty += 1;
    } else {
        req.session.cart.push({ medicineName, price: parseFloat(price), qty: 1, chemistId });
    }
    res.redirect('/');
});

app.post('/update-cart', (req, res) => {
    const { medicineName, action } = req.body;
    const item = req.session.cart.find(i => i.medicineName === medicineName);
    if (item) {
        if (action === 'plus') item.qty += 1;
        if (action === 'minus' && item.qty > 1) item.qty -= 1;
    }
    res.redirect('/');
});

app.post('/remove-item', (req, res) => {
    req.session.cart = req.session.cart.filter(i => i.medicineName !== req.body.medicineName);
    res.redirect('/');
});

// --- CHECKOUT & SQL STORAGE ---
app.post('/initiate-checkout', (req, res) => {
    const subtotal = req.session.cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const total = (subtotal + (subtotal * 0.12) + 40).toFixed(2);
    req.session.tempOrder = { total, items: [...req.session.cart] };
    res.render('payment', { total });
});

app.post('/verify-payment', async (req, res) => {
    const temp = req.session.tempOrder;
    if (temp && req.session.user) {
        const paymentId = "PAY-" + Math.floor(Math.random() * 1000000);
        try {
            await pool.query(
                'INSERT INTO orders (username, items, total_amount, payment_method, payment_id) VALUES (?, ?, ?, ?, ?)',
                [req.session.user.username, JSON.stringify(temp.items), temp.total, req.body.paymentMethod, paymentId]
            );
            req.session.cart = [];
            delete req.session.tempOrder;
            res.redirect('/track');
        } catch (err) {
            res.send("Error saving order to MySQL.");
        }
    }
});

app.get('/track', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const [rows] = await pool.query('SELECT * FROM orders WHERE username = ? ORDER BY order_date DESC', [req.session.user.username]);
    
    const formattedOrders = rows.map(o => ({
        id: o.id,
        items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
        total: o.total_amount,
        method: o.payment_method,
        paymentId: o.payment_id,
        date: o.order_date.toLocaleString()
    }));

    res.render('track', { orders: formattedOrders });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(3000, () => console.log('Marketplace Live on http://localhost:3000'));