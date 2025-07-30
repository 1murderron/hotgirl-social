const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Stripe webhook endpoint (must be before express.json middleware for raw body)
app.use('/webhook', express.raw({ type: 'application/json' }));


app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));
app.use(express.static('.'));

// File upload configuration


// Multer configuration for Cloudinary
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// JWT middleware for authentication
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT id, email, username FROM users WHERE id = $1', [decoded.id]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Admin access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user is admin (you can set this manually in database)
    const result = await pool.query('SELECT id, email, username, is_admin FROM users WHERE id = $1 AND is_admin = true', [decoded.id]);
    
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.admin = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
};

// Database initialization
async function initializeDatabase() {
  try {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        stripe_customer_id VARCHAR(255),
        stripe_payment_intent_id VARCHAR(255),
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(100),
        bio TEXT,
        profile_image_url VARCHAR(500),
        custom_colors JSONB DEFAULT '{}',
        theme VARCHAR(50) DEFAULT 'default',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS links (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        title VARCHAR(100) NOT NULL,
        url VARCHAR(500) NOT NULL,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        icon VARCHAR(50),
        clicks INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        event_data JSONB DEFAULT '{}',
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Routes

// Create Stripe checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { email, username } = req.body;

    // Check if username is already taken
    const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'hotgirl.social Profile',
            description: 'One-time payment for lifetime access to your link-in-bio profile'
          },
          unit_amount: 2900, // $29.00
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
      customer_email: email,
      metadata: {
        username: username,
        email: email
      }
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Stripe session creation error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Handle Stripe webhooks
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      // Create user account after successful payment
      const { username, email } = session.metadata;
      const tempPassword = Math.random().toString(36).substring(2, 15);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const userResult = await pool.query(
        'INSERT INTO users (email, username, password_hash, stripe_customer_id, stripe_payment_intent_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [email, username, hashedPassword, session.customer, session.payment_intent]
      );

      const userId = userResult.rows[0].id;

      // Create default profile
      const profileResult = await pool.query(
        'INSERT INTO profiles (user_id, display_name) VALUES ($1, $2) RETURNING id',
        [userId, username]
      );

      console.log(`User created successfully: ${email} (${username})`);
      
      // Here you would send a welcome email with login instructions
      // For now, we'll just log the temporary password
      console.log(`Temporary password for ${username}: ${tempPassword}`);
      
    } catch (error) {
      console.error('Error creating user after payment:', error);
    }
  }

  res.json({ received: true });
});

// User authentication routes
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Change password
app.post('/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
      [hashedNewPassword, req.user.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Profile management routes
app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const profileResult = await pool.query(`
      SELECT p.*, u.username, u.email, u.created_at 
      FROM profiles p 
      JOIN users u ON p.user_id = u.id 
      WHERE p.user_id = $1
    `, [req.user.id]);

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = profileResult.rows[0];

    // Get links
    const linksResult = await pool.query(`
      SELECT * FROM links 
      WHERE profile_id = $1 AND is_active = true 
      ORDER BY display_order, created_at
    `, [profile.id]);

    res.json({
      ...profile,
      links: linksResult.rows
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { display_name, bio, custom_colors, theme } = req.body;

    const result = await pool.query(`
      UPDATE profiles 
      SET display_name = $1, bio = $2, custom_colors = $3, theme = $4, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $5 
      RETURNING *
    `, [display_name, bio, JSON.stringify(custom_colors), theme, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Profile image upload
app.post('/profile/upload-image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    await pool.query(`
      UPDATE profiles 
      SET profile_image_url = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $2
    `, [imageUrl, req.user.id]);

    res.json({ profile_image_url: imageUrl });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});


// Links management
app.post('/links', authenticateToken, async (req, res) => {
  try {
    const { title, url, icon } = req.body;

    // Get profile ID
    const profileResult = await pool.query('SELECT id FROM profiles WHERE user_id = $1', [req.user.id]);
    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profileId = profileResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO links (profile_id, title, url, icon) 
      VALUES ($1, $2, $3, $4) 
      RETURNING *
    `, [profileId, title, url, icon]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Add link error:', error);
    res.status(500).json({ error: 'Failed to add link' });
  }
});

app.put('/links/:id', authenticateToken, async (req, res) => {
  try {
    const { title, url, icon, display_order } = req.body;
    const linkId = req.params.id;

    const result = await pool.query(`
      UPDATE links 
      SET title = $1, url = $2, icon = $3, display_order = $4 
      WHERE id = $5 AND profile_id IN (SELECT id FROM profiles WHERE user_id = $6)
      RETURNING *
    `, [title, url, icon, display_order, linkId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update link error:', error);
    res.status(500).json({ error: 'Failed to update link' });
  }
});

app.delete('/links/:id', authenticateToken, async (req, res) => {
  try {
    const linkId = req.params.id;

    const result = await pool.query(`
      UPDATE links 
      SET is_active = false 
      WHERE id = $1 AND profile_id IN (SELECT id FROM profiles WHERE user_id = $2)
      RETURNING *
    `, [linkId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    res.json({ message: 'Link deleted successfully' });
  } catch (error) {
    console.error('Delete link error:', error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// Public profile view
app.get('/u/:username', async (req, res) => {
  try {
    const { username } = req.params;

    const result = await pool.query(`
      SELECT p.*, u.username 
      FROM profiles p 
      JOIN users u ON p.user_id = u.id 
      WHERE u.username = $1 AND p.is_active = true
    `, [username]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = result.rows[0];

    // Get links
    const linksResult = await pool.query(`
      SELECT id, title, url, icon, clicks 
      FROM links 
      WHERE profile_id = $1 AND is_active = true 
      ORDER BY display_order, created_at
    `, [profile.id]);

    // Log page view
    await pool.query(`
      INSERT INTO analytics (profile_id, event_type, ip_address, user_agent) 
      VALUES ($1, 'page_view', $2, $3)
    `, [profile.id, req.ip, req.get('User-Agent')]);

    res.json({
      id: profile.id,
      display_name: profile.display_name,
      bio: profile.bio,
      profile_image_url: profile.profile_image_url,
      custom_colors: profile.custom_colors,
      theme: profile.theme,
      links: linksResult.rows
    });
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Track link clicks
app.post('/links/:id/click', async (req, res) => {
  try {
    const linkId = req.params.id;

    await pool.query('UPDATE links SET clicks = clicks + 1 WHERE id = $1', [linkId]);
    
    const linkResult = await pool.query('SELECT profile_id FROM links WHERE id = $1', [linkId]);
    if (linkResult.rows.length > 0) {
      await pool.query(`
        INSERT INTO analytics (profile_id, event_type, event_data, ip_address, user_agent) 
        VALUES ($1, 'link_click', $2, $3, $4)
      `, [linkResult.rows[0].profile_id, JSON.stringify({ link_id: linkId }), req.ip, req.get('User-Agent')]);
    }

    res.json({ message: 'Click tracked' });
  } catch (error) {
    console.error('Track click error:', error);
    res.status(500).json({ error: 'Failed to track click' });
  }
});

// Analytics
app.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const profileResult = await pool.query('SELECT id FROM profiles WHERE user_id = $1', [req.user.id]);
    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profileId = profileResult.rows[0].id;

    // Get page views for last 30 days
    const pageViewsResult = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as views
      FROM analytics 
      WHERE profile_id = $1 AND event_type = 'page_view' AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [profileId]);

    // Get link clicks
    const linksResult = await pool.query(`
      SELECT l.title, l.clicks, COUNT(a.id) as recent_clicks
      FROM links l
      LEFT JOIN analytics a ON a.event_data->>'link_id' = l.id::text AND a.created_at >= CURRENT_DATE - INTERVAL '30 days'
      WHERE l.profile_id = $1 AND l.is_active = true
      GROUP BY l.id, l.title, l.clicks
      ORDER BY l.clicks DESC
    `, [profileId]);

    // Get total stats
    const totalViewsResult = await pool.query(`
      SELECT COUNT(*) as total_views
      FROM analytics 
      WHERE profile_id = $1 AND event_type = 'page_view'
    `, [profileId]);

    res.json({
      page_views: pageViewsResult.rows,
      link_stats: linksResult.rows,
      total_views: parseInt(totalViewsResult.rows[0].total_views)
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Contact form submission
app.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    await pool.query(`
      INSERT INTO contact_messages (name, email, subject, message) 
      VALUES ($1, $2, $3, $4)
    `, [name, email, subject, message]);

    res.json({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ADMIN ROUTES

// Admin dashboard stats
app.get('/admin/stats', authenticateAdmin, async (req, res) => {
  try {
    // Get total users
    const totalUsersResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = parseInt(totalUsersResult.rows[0].count);

    // Get active profiles
    const activeProfilesResult = await pool.query('SELECT COUNT(*) as count FROM profiles WHERE is_active = true');
    const activeProfiles = parseInt(activeProfilesResult.rows[0].count);

    // Get total revenue (assuming $29 per user)
    const totalRevenue = totalUsers * 29;

    // Get monthly signups
    const monthlySignupsResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);
    const monthlySignups = parseInt(monthlySignupsResult.rows[0].count);

    // Get total page views
    const totalViewsResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM analytics 
      WHERE event_type = 'page_view'
    `);
    const totalViews = parseInt(totalViewsResult.rows[0].count);

    // Get total clicks
    const totalClicksResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM analytics 
      WHERE event_type = 'link_click'
    `);
    const totalClicks = parseInt(totalClicksResult.rows[0].count);

    // Get average links per profile
    const avgLinksResult = await pool.query(`
      SELECT AVG(link_count) as avg_links
      FROM (
        SELECT COUNT(*) as link_count 
        FROM links 
        WHERE is_active = true 
        GROUP BY profile_id
      ) as link_counts
    `);
    const avgLinks = parseFloat(avgLinksResult.rows[0]?.avg_links || 0).toFixed(1);

    res.json({
      totalUsers,
      activeProfiles,
      totalRevenue,
      monthlySignups,
      totalViews,
      totalClicks,
      avgLinks,
      conversionRate: totalUsers > 0 ? ((activeProfiles / totalUsers) * 100).toFixed(1) : 0
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// Get all users with pagination
app.get('/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let query = `
      SELECT u.id, u.email, u.username, u.created_at, u.updated_at,
             p.is_active as profile_active,
             COUNT(a.id) as total_views
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      LEFT JOIN analytics a ON p.id = a.profile_id AND a.event_type = 'page_view'
    `;
    
    const queryParams = [];
    
    if (search) {
      query += ` WHERE u.email ILIKE $1 OR u.username ILIKE $1`;
      queryParams.push(`%${search}%`);
    }
    
    query += ` 
      GROUP BY u.id, u.email, u.username, u.created_at, u.updated_at, p.is_active
      ORDER BY u.created_at DESC 
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;
    
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as count FROM users';
    const countParams = [];
    
    if (search) {
      countQuery += ' WHERE email ILIKE $1 OR username ILIKE $1';
      countParams.push(`%${search}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all profiles with stats
app.get('/admin/profiles', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let query = `
      SELECT p.id, p.display_name, p.bio, p.is_active, p.created_at,
             u.username, u.email,
             COUNT(DISTINCT l.id) as link_count,
             COUNT(DISTINCT a.id) as total_views
      FROM profiles p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN links l ON p.id = l.profile_id AND l.is_active = true
      LEFT JOIN analytics a ON p.id = a.profile_id AND a.event_type = 'page_view'
    `;
    
    const queryParams = [];
    
    if (search) {
      query += ` WHERE u.username ILIKE $1 OR p.display_name ILIKE $1`;
      queryParams.push(`%${search}%`);
    }
    
    query += ` 
      GROUP BY p.id, p.display_name, p.bio, p.is_active, p.created_at, u.username, u.email
      ORDER BY p.created_at DESC 
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;
    
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as count 
      FROM profiles p 
      JOIN users u ON p.user_id = u.id
    `;
    const countParams = [];
    
    if (search) {
      countQuery += ' WHERE u.username ILIKE $1 OR p.display_name ILIKE $1';
      countParams.push(`%${search}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      profiles: result.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Admin get profiles error:', error);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// Get payment history
app.get('/admin/payments', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.username, u.email, u.created_at as payment_date,
             u.stripe_customer_id, u.stripe_payment_intent_id
      FROM users u
      WHERE u.stripe_customer_id IS NOT NULL
      ORDER BY u.created_at DESC
      LIMIT 100
    `);

    const payments = result.rows.map(row => ({
      username: row.username,
      email: row.email,
      date: row.payment_date,
      amount: 29.00, // Fixed amount for now
      stripe_customer_id: row.stripe_customer_id,
      stripe_payment_intent_id: row.stripe_payment_intent_id,
      status: 'completed'
    }));

    res.json({ payments });
  } catch (error) {
    console.error('Admin payments error:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Get contact messages
app.get('/admin/messages', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM contact_messages 
      ORDER BY created_at DESC
    `);

    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Admin messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Mark message as read
app.put('/admin/messages/:id/read', authenticateAdmin, async (req, res) => {
  try {
    const messageId = req.params.id;
    
    await pool.query('UPDATE contact_messages SET is_read = true WHERE id = $1', [messageId]);
    
    res.json({ message: 'Message marked as read' });
  } catch (error) {
    console.error('Mark message read error:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// Suspend/activate user
app.put('/admin/users/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { is_active } = req.body;
    
    // Update profile status
    await pool.query('UPDATE profiles SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', 
      [is_active, userId]);
    
    res.json({ message: `User ${is_active ? 'activated' : 'suspended'} successfully` });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Delete user and all associated data
app.delete('/admin/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // This will cascade delete profiles, links, and analytics due to foreign key constraints
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get recent activity for dashboard
app.get('/admin/activity', authenticateAdmin, async (req, res) => {
  try {
    // Get recent user registrations
    const recentUsersResult = await pool.query(`
      SELECT username, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    // Get recent page views
    const recentViewsResult = await pool.query(`
      SELECT COUNT(*) as views, DATE(created_at) as date
      FROM analytics 
      WHERE event_type = 'page_view' 
        AND created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Get recent contact messages
    const recentMessagesResult = await pool.query(`
      SELECT name, subject, created_at 
      FROM contact_messages 
      ORDER BY created_at DESC 
      LIMIT 3
    `);

    const activity = [
      ...recentUsersResult.rows.map(user => ({
        type: 'user_registration',
        message: `New user registration: ${user.username}`,
        timestamp: user.created_at
      })),
      ...recentMessagesResult.rows.map(msg => ({
        type: 'contact_message',
        message: `New contact message from ${msg.name}: ${msg.subject}`,
        timestamp: msg.created_at
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);

    res.json({ activity });
  } catch (error) {
    console.error('Admin activity error:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// Admin login (separate from regular user login)
app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND is_admin = true', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        username: admin.username
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Admin login failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Initialize and start server
async function startServer() {
  try {
    await initializeDatabase();
    
    // Create uploads directory if it doesn't exist
    await fs.mkdir('public/uploads', { recursive: true });
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
