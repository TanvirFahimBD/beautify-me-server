//! require modules
const express = require('express');
const cors = require('cors')
require('dotenv').config()
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = 5000 || process.env.PORT;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

//TODO: send email
//TODO: live host server

//! middleware
app.use(cors())
app.use(express.json())

//! mongodb config
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xdvumxh.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('beautify_me').collection('services');
        const bookingCollection = client.db('beautify_me').collection('booking');
        const userCollection = client.db('beautify_me').collection('user');
        const barberCollection = client.db('beautify_me').collection('barber');
        const paymentCollection = client.db('beautify_me').collection('payments');

        const verifyAdmin = async (req, res, next) => {
            const requesterEmail = req.decoded.email;
            const requester = await userCollection.findOne({ email: requesterEmail });
            if (requester?.role === 'admin') {
                next()
            } else {
                res.status(403).send({ message: 'Forbidden access' })
            }
        }

        // ********************** payment **********************
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            })
        })

        // ********************** services **********************
        //! get service
        app.get('/service', async (req, res) => {
            const services = await serviceCollection.find({}).project({ name: 1 }).toArray();
            res.send(services);
        })

        // ********************** booking **********************
        //!get booking single 
        app.get('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        //!get treatment single 
        app.get('/booking/review/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        //!get booking by email
        app.get('/booking/email/:email', async (req, res) => {
            const email = req.params.email;
            const query = { patient: email };
            const booking = await bookingCollection.find(query).toArray();
            res.send(booking);
        })

        //!patch booking single payment
        app.patch('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const payment = req.body;
            const updateDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            };
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updatedBooking);
        })

        //!patch booking single review
        app.patch('/booking/review/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const { review } = req.body;
            const updateDoc = {
                $set: {
                    review: review
                }
            };
            const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updatedBooking);
        })

        //! get booking
        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (decodedEmail === patient) {
                const booking = await bookingCollection.find({ patient }).toArray();
                res.send(booking);
            } else {
                res.status(401).send({ message: 'Unauthorized access' })
            }
        })

        //! post available
        app.get('/available', async (req, res) => {
            const services = await serviceCollection.find({}).toArray();
            const date = req.query.date;
            const bookings = await bookingCollection.find({ date }).toArray();
            services.forEach(service => {
                const serviceBooking = bookings.filter(booking => booking.treatment === service.name)
                const booked = serviceBooking.map(serviceBook => serviceBook.slot)
                const available = service.slots.filter(slot => !booked.includes(slot))
                service.slots = available
            })
            res.send(services);
        })

        //! post booking
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            console.log('bk', booking);
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (!exists) {
                const bookingResult = await bookingCollection.insertOne(booking);
                res.send(bookingResult);
            } else {
                res.status(400).send({ message: 'Booking already exists' });
                return;
            }
        })

        // ********************** users **********************
        //! get user
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find({}).toArray();
            res.send(users);
        })

        //! put user
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            }
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1d'
            });
            res.send({ result, token });
        })

        //! delete user
        app.delete('/user/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await userCollection.deleteOne(filter);
            res.send(result);
        })

        //! put admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        //! get admin
        app.get('/user/admin/:email', verifyJWT, async (req, res) => {
            const requesterEmail = req.decoded.email;
            const requester = await userCollection.findOne({ email: requesterEmail });
            if (requester?.role === 'admin') {
                res.send({ admin: true });
            } else {
                res.send({ admin: false });
            }
        })


        // ********************** barber **********************
        //! post barber
        app.post('/barber', verifyJWT, verifyAdmin, async (req, res) => {
            const barber = req.body;
            const barbers = await barberCollection.insertOne(barber);
            res.send(barbers);
        })

        //!get barber
        app.get('/barber', verifyJWT, verifyAdmin, async (req, res) => {
            const barbers = await barberCollection.find({}).toArray();
            res.send(barbers);
        })

        //!delete barber
        app.delete('/barber/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const result = await barberCollection.deleteOne({ email });
            res.send(result);
        })
    }

    finally {
        // client.close()
    }
}
run().catch(console.dir)

//! get root
app.get('/', (req, res) => {
    res.send('Beautify Me Server Live')
})

//! listen root
app.listen(port, (req, res) => {
    console.log(`Listening at port : ${port}`)
})