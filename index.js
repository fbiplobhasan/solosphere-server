const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 9000;
const app = express();
const cookieParser = require('cookie-parser');

const corsOptions = {
  origin: [
    'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200,
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dqhfr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: 'unAuthorized access' })
  }
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unAuthorized access' })
    }

    req.user = decoded;
    next()
  })
  
}

async function run() {
  try {

    const db = client.db('solos-db')
    const jobsCollection = db.collection('jobs')
    const bidsCollection = db.collection('bids')

    // generate jwt
    app.post('/jwt', async (req, res) => {
      const email = req.body;
      // create token
      const token = jwt.sign(email, process.env.SECRET_KEY, { expiresIn: '365d', })
      console.log(token);
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })

        .send({ success: true });
    })

    // logout || clear cookie from browser
    app.get('/logout', async (req, res) => {
      res
        .clearCookie('token', {
          maxAge: 0,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })

        .send({ success: true });
    })

    // save a jobData in db
    app.post('/add-job', async (req, res) => {
      const jobData = req.body;
      const result = await jobsCollection.insertOne(jobData);
      res.send(result);
    })

    // get all data from jobsCollection
    app.get('/jobs', async (req, res) => {
      const result = await jobsCollection.find().toArray()
      res.send(result);
    });

    // get all jobs posted by a specific user
    app.get('/jobs/:email',verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user?.email
      // console.log('email from token --->', decodedEmail);
      // console.log('email from params', email)
      if (decodedEmail !== email) {
        return res.status(401).send({ message: 'unAuthorized access' })
      }
      const query = { 'buyer.email': email }
      const result = await jobsCollection.find(query).toArray()
      res.send(result);
    })

    // Delete specific one id from server side code
    app.delete('/job/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await jobsCollection.deleteOne(query)
      res.send(result);
    })

    // get a signle data from db
    app.get('/job/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await jobsCollection.findOne(query);
      res.send(result);
    })

    // update a jobData in db
    app.put('/update-job/:id', async (req, res) => {
      const id = req.params.id;
      const jobData = req.body;
      const updatedData = {
        $set: jobData,
      }
      const query = { _id: new ObjectId(id) };
      const option = { upsert: true }
      const result = await jobsCollection.updateOne(query, updatedData, option);
      res.send(result);
    })

    //save a bid data in db
    app.post('/add-bid', async (req, res) => {
      const bidData = req.body;
      // 0. if a user placed a bid already in this job
      const query = { email: bidData.email, jobId: bidData.jobId }
      const alreadyExist = await bidsCollection.findOne(query)
      if (alreadyExist) return res.status(400).send('You have already placed a bid on this job!.')
      // 1. save data in jobCollection collection
      const result = await bidsCollection.insertOne(bidData);

      // 2. Increase bid count in bids collection
      const filter = { _id: new ObjectId(bidData.jobId) };
      const update = {
        $inc: { bid_count: 1 },
      };
      const updateBidCount = await jobsCollection.updateOne(filter, update)
      res.send(result);
    })

    // get all bids for a specific user
    app.get('/bids/:email', verifyToken, async (req, res) => {
      const isBuyer = req.query.buyer;
      const email = req.params.email;
      const decodedEmail = req.user?.email
      // console.log('email from token --->', decodedEmail);
      // console.log('email from params', email)
      if (decodedEmail !== email) {
        return res.status(401).send({ message: 'unAuthorized access' })
      }

      let query = {};
      if (isBuyer) {
        query.buyer = email
      } else {
        query.email = email;
      }
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    })
    // get all bid request for a specific user
    app.get('/bids-requests/:email', async (req, res) => {
      const email = req.params.email;
      const query = { buyer: email };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    })

    // update bid status
    app.patch('/bid-status-update/:id', async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updated = {
        $set: { status },

      }
      const result = await bidsCollection.updateOne(filter, updated);
      res.send(result);
    })

    // get all jobs
    app.get('/all-jobs', async (req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;
      let option = {};
      if (sort) option = { sort: { deadline: sort === 'asc' ? 1 : -1 } };
      let query = {
        title: {
          $regex: search, $options: "i",
        }
      };
      if (filter) query.category = filter;
      const result = await jobsCollection.find(query, option).toArray();
      res.send(result);
    })
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)
app.get('/', (req, res) => {
  res.send('Hello from SoloSphere Server....')
})

app.listen(port, () => console.log(`Server running on port ${port}`))
