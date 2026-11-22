import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'
import { jwtVerify } from 'jose'
import { MongoClient, ObjectId } from 'mongodb'
import 'dotenv/config'

const app = express()
const PORT = process.env.PORT || 5000
const NODE_ENV = process.env.NODE_ENV || 'development'

// Allow the client app(s) to call this API. Configure via CLIENT_URL
// (comma-separated for multiple origins) so production has no CORS errors.
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

app.use(express.json())
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is not set — add it to pizzahub-server/.env')
}

const client = new MongoClient(MONGODB_URI)

export async function connectToMongoDB() {
  try {
    await client.connect()
    console.log('You successfully connected to MongoDB!')
    return client
  } catch (err) {
    console.error('MongoDB connection failed:', err)
    throw err
  }
}

// ── Database & collections (§13) ────────────────────────────
const connectedClient = await connectToMongoDB()
const database = connectedClient.db(process.env.MONGODB_DB_NAME || 'pizzahub')

// Better Auth owns and manages its own auth collections (left as-is):
//   user    → name, email, image, role (admin|vendor|customer), ...
//   session → Better Auth session + token records
// (Better Auth uses the singular `user`; §13 labels this the `users` collection.)
const users = database.collection('user')
const sessions = database.collection('session')

// The four business collections (§13). All *Id fields reference another
// collection's `_id`.
//   menuItems    → vendorId (ref user), itemName, category, description, price,
//                  location, image, status (pending|approved|rejected|inactive),
//                  createdAt
//   orders       → itemId (ref menuItems), vendorId (ref user), customerId (ref user),
//                  deliveryDate, deliveryAddress, message,
//                  status (pending|accepted|rejected|cancelled), createdAt
//   transactions → vendorId (ref user), plan, amount, currency, stripeSessionId,
//                  stripeSubscriptionId, status, createdAt
const menuItems = database.collection('menuItems')
const orders = database.collection('orders')
const transactions = database.collection('transactions')

// ── Indexes (step 8) ────────────────────────────────────────
// Matching, unique index on `user.email` is created by Better Auth.
async function ensureIndexes() {
  await Promise.all([
    // users: admin "manage users" filters/lists by role
    users.createIndex({ role: 1 }, { name: 'user_role_idx' }),

    // menuItems: public listing filters by status; dashboards/ownership by vendor
    menuItems.createIndex({ status: 1 }, { name: 'menuItems_status_idx' }),
    menuItems.createIndex({ category: 1 }, { name: 'menuItems_category_idx' }),
    menuItems.createIndex({ location: 1 }, { name: 'menuItems_location_idx' }),
    menuItems.createIndex(
      { vendorId: 1, createdAt: -1 },
      { name: 'menuItems_vendor_idx' }
    ),

    // orders: duplicate-active guard (same item + delivery date + status)
    orders.createIndex(
      { itemId: 1, deliveryDate: 1, status: 1 },
      { name: 'orders_active_idx' }
    ),
    orders.createIndex(
      { customerId: 1, createdAt: -1 },
      { name: 'orders_customer_idx' }
    ),
    orders.createIndex(
      { vendorId: 1, createdAt: -1 },
      { name: 'orders_vendor_idx' }
    ),

    // transactions: per-vendor payment history
    transactions.createIndex(
      { vendorId: 1, createdAt: -1 },
      { name: 'transactions_vendor_idx' }
    ),
  ])
  console.log('Indexes ensured.')
}

await ensureIndexes()

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// ── JWT auth + role middleware (§12) ────────────────────────
const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set — add it to pizzahub-server/.env')
}

const jwtKey = new TextEncoder().encode(JWT_SECRET)

// Verify the Bearer JWT (signature + expiry), then load the *current* user from
// the DB so role and blocked status are always authoritative (never trusted
// from the token/client).
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    // Throws on a bad signature, malformed or expired token.
    const { payload } = await jwtVerify(token, jwtKey)

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(payload.sub))
    const user = isObjectId
      ? await users.findOne({ _id: new ObjectId(payload.sub) })
      : null

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'This account is blocked' })
    }

    req.user = user
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

// Role guard: requireRole('admin') / requireRole('customer', 'vendor')
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Forbidden' })
  }
  next()
}
// ── menu related api ────────────────────────────────────────

// add menu item (vendor) — vendorId, status and plan limits are enforced
// server-side, never taken from the request body (§22)
app.post('/menu-items', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    const vendorId = req.user._id
    const { itemName, category, description, price, location, image, images } =
      req.body ?? {}

    if (
      !itemName ||
      !category ||
      !description ||
      !location ||
      !image ||
      price === undefined ||
      price === null ||
      price === ''
    ) {
      return res.status(400).json({
        message:
          'itemName, category, description, price, location and image are required',
      })
    }

    const numericPrice = Number(price)
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res
        .status(400)
        .json({ message: 'price must be a valid non-negative number' })
    }

    // Free plan: max 3 active (approved) items (§8/§10)
    const plan = req.user.subscriptionPlan ?? 'free'
    if (plan !== 'premium') {
      const activeItems = await menuItems.countDocuments({
        vendorId,
        status: 'approved',
      })
      if (activeItems >= 3) {
        return res.status(403).json({
          message:
            'Free plan allows up to 3 active items. Upgrade to Premium to add more.',
        })
      }
    }

    const item = {
      vendorId,
      vendorName: req.user.businessName ?? req.user.name ?? null,
      itemName: String(itemName).trim(),
      category,
      description: String(description).trim(),
      price: numericPrice,
      location: String(location).trim(),
      image,
      ...(Array.isArray(images) ? { images } : {}),
      status: 'pending',
      createdAt: new Date(),
    }

    const result = await menuItems.insertOne(item)
    res.status(201).json(result)
  } catch (error) {
    console.error('Failed to add menu item:', error)
    res.status(500).json({ message: 'Failed to add menu item' })
  }
})

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const asString = (value) => (typeof value === 'string' ? value.trim() : '')

// load or get added menu items (search + category/location filters + price sort)
app.get('/menu-items', async (req, res) => {
  try {
    const query = {}
    const search = asString(req.query.search)
    const category = asString(req.query.category)
    const location = asString(req.query.location)
    const status = asString(req.query.status)
    const sort = asString(req.query.sort)

    if (status) query.status = status
    if (category) query.category = category
    if (location) query.location = { $regex: escapeRegex(location), $options: 'i' }

    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' }
      query.$or = [
        { itemName: regex },
        { location: regex },
        { category: regex },
      ]
    }

    const sortOptions = {
      'price-asc': { price: 1 },
      'price-desc': { price: -1 },
    }

    const cursor = menuItems.find(query)
    if (sortOptions[sort]) cursor.sort(sortOptions[sort])

    const result = await cursor.toArray()
    res.send(result)
  } catch (error) {
    console.error('Failed to load menu items:', error)
    res.status(500).json({ message: 'Failed to load menu items' })
  }
})

// distinct locations used by approved items (for the browse-menu filter)
app.get('/menu-items/locations', async (req, res) => {
  try {
    const locations = await menuItems.distinct('location', { status: 'approved' })
    res.json(locations.filter(Boolean).sort((a, b) => a.localeCompare(b)))
  } catch (error) {
    console.error('Failed to load menu locations:', error)
    res.status(500).json({ message: 'Failed to load menu locations' })
  }
})

// one menu item (browse-menu details page).
// NOTE: keep this AFTER "/menu-items/locations", otherwise "locations" is
// captured as the :id.
app.get('/menu-items/:id', async (req, res) => {
  try {
    const { id } = req.params
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id)
    const item = await menuItems.findOne({
      _id: isObjectId ? new ObjectId(id) : id,
    })

    if (!item) {
      return res.status(404).json({ message: 'Menu item not found' })
    }

    res.json(item)
  } catch (error) {
    console.error('Failed to load menu item:', error)
    res.status(500).json({ message: 'Failed to load menu item' })
  }
})

// delete a menu item (supports both ObjectId ids and seeded string ids)
app.delete('/menu-items/:id', async (req, res) => {
  try {
    const { id } = req.params
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(id)
    const result = await menuItems.deleteOne({
      _id: isObjectId ? new ObjectId(id) : id,
    })

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Menu item not found' })
    }

    res.json(result)
  } catch (error) {
    console.error('Failed to delete menu item:', error)
    res.status(500).json({ message: 'Failed to delete menu item' })
  }
})

// ── users ───────────────────────────────────────────────────

// to get all users data (admin only)
app.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await users.find({}).toArray()
    res.json(result)
  } catch (error) {
    console.error('Failed to load users:', error)
    res.status(500).json({ message: 'Failed to load users' })
  }
})

app.get('/users/:id/premium',async(req,res)=>{
  const id = req.params.id
  const query =  {_id: new ObjectId(id)}
  const result = await users.findOne(query,{projection:{Premium:1}})
  res.send(result)
})

// ── vendor dashboard ────────────────────────────────────────

// overview counts for the signed-in vendor (vendorId from the JWT, never the client)
app.get('/vendor/overview', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    const vendorId = req.user._id

    const [totalItems, activeItems, pendingOrders, acceptedOrders, rejectedOrders] =
      await Promise.all([
        menuItems.countDocuments({ vendorId }),
        menuItems.countDocuments({ vendorId, status: 'approved' }),
        orders.countDocuments({ vendorId, status: 'pending' }),
        orders.countDocuments({ vendorId, status: 'accepted' }),
        orders.countDocuments({ vendorId, status: 'rejected' }),
      ])

    res.json({
      totalItems,
      activeItems,
      pendingOrders,
      acceptedOrders,
      rejectedOrders,
      subscriptionPlan: req.user.subscriptionPlan ?? 'free',
    })
  } catch (error) {
    console.error('Failed to load vendor overview:', error)
    res.status(500).json({ message: 'Failed to load vendor overview' })
  }
})
// ── orders ──────────────────────────────────────────────────

// list orders — a customer's own orders, or a vendor's incoming orders
app.get('/orders', requireAuth, requireRole('customer', 'vendor', 'admin'), async (req, res) => {
  const query = {}
 if(req.query.customerId){
    query.userId = req.query.customerId
  }
 if(req.query.menuId){
  const menuQuery = {_id: new ObjectId(req.query.menuId)}
  const menu = await menuItems.findOne( menuQuery)
    if(menu.vendorId !== req.user._id.toString() && req.user.role !== 'admin'){
    res.status(403).send({message:'Forbidden'});
    return
  }
    query.menuId = req.query.menuId
  }


  const cursor = applications.find(query)
  const result = await cursor.toArray()
  res.send(result)
})


//ordered menu by customer
app.get('/orders',async(req,res)=>{
  const query ={}
  if(req.query.customerId){
    query.userId = req.query.customerId
  }
  const cursor = orders.find(query)
  const result = await cursor.toArray()
  res.send(result)
})

//count order menu
app.get('/orders/count',async(req,res)=>{
  const query ={}
  if(req.query.customerId){
    query.userId = req.query.customerId
  }

  const result = await orders.countDocuments(query)
  res.send({count:result})
})

// place an order (customers only — vendors and admins cannot order, §7)
app.post('/orders', requireAuth, requireRole('customer'), async (req, res) => {
  try {
    // Never trust identity from the request body (§22) — take it from the
    // verified JWT. vendorId and status are derived server-side too.
    const customerId = req.user._id.toString()
    const customerName = req.user.name ?? null
    const customerEmail = req.user.email ?? null

    const { itemId, deliveryDate, deliveryAddress, message } = req.body ?? {}

    if (!itemId || !deliveryDate || !deliveryAddress) {
      return res.status(400).json({
        message: 'itemId, deliveryDate and deliveryAddress are required',
      })
    }

    const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(itemId))
    const item = await menuItems.findOne({
      _id: isObjectId ? new ObjectId(itemId) : itemId,
    })

    if (!item) {
      return res.status(404).json({ message: 'Menu item not found' })
    }

    if (item.status !== 'approved') {
      return res
        .status(409)
        .json({ message: 'This item is not available to order' })
    }

    // one active order per customer + item + delivery date
    const duplicate = await orders.findOne({
      customerId,
      itemId: item._id,
      deliveryDate,
      status: { $in: ['pending', 'accepted'] },
    })

    if (duplicate) {
      return res.status(409).json({
        message: 'You already have an active order for this item on that date',
      })
    }

    const order = {
      // references (all derived server-side, never from the body)
      itemId: item._id,
      vendorId: item.vendorId ?? null,
      customerId,

      // item snapshot
      itemName: item.itemName,
      itemImage: item.image ?? null,
      price: item.price,

      // vendor / customer snapshot
      vendorName: item.vendorName ?? null,
      customerName: customerName ?? null,
      customerEmail: customerEmail ?? null,

      // delivery
      deliveryDate,
      deliveryAddress,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,

      // meta
      status: 'pending',
      createdAt: new Date(),
    }

    const result = await orders.insertOne(order)
    res.status(201).json(result)
  } catch (error) {
    console.error('Failed to place order:', error)
    res.status(500).json({ message: 'Failed to place order' })
  }
})

app.post('/payments/checkout-verify', async (req, res) => {
  const {sessionId}=req.body

  if(!sessionId){
    return res.send({success:false,message:'Session ID is required'})
  }
   const sessionQuery = {sessionId}
      const existingPayment = await transactions.findOne(sessionQuery)
      if(existingPayment){
        return res.send({success:false,message:'Payment already exists'})
      };

 const {
    status,
    customer_details,
    payment_status
  } = await stripe.checkout.sessions.retrieve(session_id)

  if(status === 'complete' && payment_status === 'paid'){


const payment ={
  status,
    payment_status,
    customer_email,
   userId: metadata.userId,
   payment_DATE: new Date(),
    payment_intent,
}
  const result = await transactions.insertOne(payment)
  //update user table
  const query = { _id: new ObjectId(metadata.userId) };
  const updateDoc = {
    $set: {
      Premium: true,
    },
  }
  const updateResult = await users.updateOne(
    query,
    updateDoc
  );
  
    res.send({success: true,result,updateResult})
    return
  }
  res.send({success:false,message:'Payment verification failed'})
})



// ── 404 + central error handler (registered after all routes) ──

app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Route not found: ${req.method} ${req.originalUrl}` })
})

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  const status = err.status || err.statusCode || 500
  res.status(status).json({
    message: err.message || 'Internal Server Error',
    ...(NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  })
})

app.listen(PORT, () => {
  console.log(`PizzaHub server listening on port ${PORT} (${NODE_ENV})`)
})

export default app
