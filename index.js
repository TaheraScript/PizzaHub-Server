import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import 'dotenv/config'

const app = express()
const PORT = process.env.PORT || 5000

app.use(express.json())
app.use(cors())

const client = new MongoClient(
  `mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-jzpvg2z-shard-00-00.sq6hc5o.mongodb.net:27017,ac-jzpvg2z-shard-00-01.sq6hc5o.mongodb.net:27017,ac-jzpvg2z-shard-00-02.sq6hc5o.mongodb.net:27017/?ssl=true&replicaSet=atlas-lorrmj-shard-0&authSource=admin`
)

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

const connectedClient = await connectToMongoDB()
const database = connectedClient.db('pizzahub')
const users = database.collection('user')
const menuItems = database.collection('menuItems')
const orders = database.collection('orders')

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// ── menu related api ────────────────────────────────────────

// add menu item (vendor)
app.post('/menu-items', async (req, res) => {
  try {
    const result = await menuItems.insertOne(req.body)
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

// to get all users data
app.get('/users', async (req, res) => {
  try {
    const result = await users.find({}).toArray()
    res.json(result)
  } catch (error) {
    console.error('Failed to load users:', error)
    res.status(500).json({ message: 'Failed to load users' })
  }
})

// ── orders ──────────────────────────────────────────────────

// list orders — a customer's own orders, or a vendor's incoming orders
app.get('/orders', async (req, res) => {
  try {
    const customerId = asString(req.query.customerId)
    const vendorId = asString(req.query.vendorId)
    const status = asString(req.query.status)

    const query = {}
    if (customerId) query.customerId = customerId
    if (vendorId) query.vendorId = vendorId
    if (status) query.status = status

    const result = await orders.find(query).sort({ createdAt: -1 }).toArray()
    res.json(result)
  } catch (error) {
    console.error('Failed to load orders:', error)
    res.status(500).json({ message: 'Failed to load orders' })
  }
})

app.get('/orders',async(req,res)=>{
  const query ={}
  if(req.query.customerId){
    query.userId = req.query.customerId
  }
  const cursor = orders.find(query)
  const result = await cursor.toArray()
  res.send(result)
})

// place an order (customer)
app.post('/orders', async (req, res) => {
  try {
    const {
      itemId,
      customerId,
      customerName,
      customerEmail,
      deliveryDate,
      deliveryAddress,
      message,
    } = req.body ?? {}

    if (!itemId || !customerId || !deliveryDate || !deliveryAddress) {
      return res.status(400).json({
        message:
          'itemId, customerId, deliveryDate and deliveryAddress are required',
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
      // references
      itemId: item._id,
      vendorId: item.vendorId ?? null,
      // TODO: take customerId from the verified JWT, never from the body
      // (docs/REQUIREMENTS.md §22). No auth middleware on this server yet.
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

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`)
})

export default app
