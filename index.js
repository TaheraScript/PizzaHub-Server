import express from 'express';
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json())
app.use(cors())
console.log(process.env.DB_USER)

const client = new MongoClient(`mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-jzpvg2z-shard-00-00.sq6hc5o.mongodb.net:27017,ac-jzpvg2z-shard-00-01.sq6hc5o.mongodb.net:27017,ac-jzpvg2z-shard-00-02.sq6hc5o.mongodb.net:27017/?ssl=true&replicaSet=atlas-lorrmj-shard-0&authSource=admin`);


export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const connectedClient = await connectToMongoDB()
const database = connectedClient.db('pizzahub');
const users = database.collection("user");
const menuItems= database.collection('menuItems')


app.get('/', (req, res) => {
  res.send('Hello World!');
});

//menu related api
//add menu item(vendor)
app.post('/menu-items',async(req,res)=>{
  const menuItem = req.body
  const result = await menuItems.insertOne(menuItem)
  res.send(result)
})

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const asString = (value) => (typeof value === 'string' ? value.trim() : '')

//load or get added menu items (search + category/location filters + price sort)
app.get('/menu-items',async(req,res)=>{
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

//distinct locations used by approved items (for the browse-menu filter)
app.get('/menu-items/locations',async(req,res)=>{
  try {
    const locations = await menuItems.distinct('location', { status: 'approved' })
    res.json(locations.filter(Boolean).sort((a, b) => a.localeCompare(b)))
  } catch (error) {
    console.error('Failed to load menu locations:', error)
    res.status(500).json({ message: 'Failed to load menu locations' })
  }
})

//delete a menu item (supports both ObjectId ids and seeded string ids)
app.delete('/menu-items/:id',async(req,res)=>{
  try {
    const id = req.params.id
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
//to get all users data
app.get('/users', async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result)
})

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
 export default app