# 🍕 PizzaHub — Pizza Ordering & Delivery API

**Powering seamless pizza ordering and restaurant management.**

PizzaHub Server is the backend API of PizzaHub, a full-stack pizza ordering and delivery platform. Built with Express.js and MongoDB, it provides RESTful API endpoints for managing users, restaurant profiles, pizza menu items, customer orders, and vendor subscriptions. It also handles authentication, role-based authorization, menu item approvals, and secure Stripe payment processing.

🔗 **Live API:** [PizzaHub](https://pizzahub-client-rust.vercel.app/)

## 📸 Project Screenshot

![Pizzahub Screenshot](./public/images/pizzahub-homepage.png)

## ✨ Key Features

1. **🔐 JWT Authentication & Authorization** — Verify authenticated requests using JWT tokens and protect API endpoints with role-based access control for Customers, Vendors, and Admins.

2. **👥 User Management** — Manage user information, roles, account status, restaurant details, and subscription information.

3. **🍕 Menu Item Management** — Create, retrieve, update, and delete restaurant menu items with ownership verification.

4. **📋 Menu Approval System** — Allow administrators to review submitted menu items and approve or reject them before public availability.

5. **🔎 Advanced Search & Filtering** — Search menu items by name, filter by category and restaurant location, and sort results by price.

6. **🛒 Customer Order Management** — Create orders, retrieve personal order history, view order details, and cancel pending orders.

7. **📦 Vendor Order Processing** — Allow vendors to retrieve incoming orders and accept or reject pending requests belonging to their restaurants.

8. **🚫 Order Validation & Restrictions** — Prevent vendors from ordering their own menu items and prevent duplicate active orders for the same item and delivery date.

9. **💳 Stripe Subscription Integration** — Create Stripe Checkout sessions for Premium vendor subscriptions and process verified webhook events.

10. **🧾 Transaction Management** — Store and retrieve vendor subscription transaction records for administrative monitoring.

11. **🖼️ Image Upload Integration** — Integrate ImgBB for menu item image uploads and return image URLs for database storage.

12. **⭐ Subscription Plan Management** — Enforce the Free plan limit of three active menu items while allowing Premium vendors to publish unlimited active items.

13. **🛡️ Admin Management** — Provide administrative endpoints for managing users, reviewing menu items, and monitoring transactions.

14. **⚙️ Request Validation & Error Handling** — Validate incoming requests and return appropriate HTTP status codes and error messages.

15. **🔒 Secure API Configuration** — Configure environment variables, CORS, protected routes, and server-side verification for sensitive operations.

## 🧰 Technologies Used

| Category | Technologies |
|---|---|
| Backend Framework | Express.js |
| Runtime | Node.js |
| Language | JavaScript / TypeScript |
| Database | MongoDB |
| Authentication | Better Auth JWT |
| JWT Verification | jose |
| Payment Integration | Stripe |
| Image Upload | ImgBB |
| Environment Variables | dotenv |
| Cross-Origin Requests | CORS |
| API Architecture | REST API |

## 📜 API Endpoints

The following tables describe the planned API structure. Update the paths and HTTP methods if your actual server implementation differs.

### 🍕 Menu Management

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/menu` | Retrieve approved and active menu items | Public |
| GET | `/menu/:id` | Retrieve menu item details | Authenticated |
| POST | `/menu` | Create a new menu item | Vendor |
| PATCH | `/menu/:id` | Update an owned menu item | Vendor |
| DELETE | `/menu/:id` | Delete an owned menu item | Vendor |
| PATCH | `/menu/:id/availability` | Update menu item availability | Vendor |

### 🛒 Customer Orders

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/orders` | Place a new order | Customer |
| GET | `/my-orders` | Retrieve personal orders | Customer |
| GET | `/orders/:id` | Retrieve order details | Authorized User |
| PATCH | `/orders/:id/cancel` | Cancel a pending order | Customer |

### 📦 Vendor Order Management

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/vendor/orders` | Retrieve incoming restaurant orders | Vendor |
| PATCH | `/vendor/orders/:id/status` | Accept or reject a pending order | Vendor |

### 💳 Subscription Management

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/vendor/subscription` | Retrieve vendor subscription details | Vendor |
| POST | `/subscriptions/create-checkout-session` | Create a Stripe Checkout session | Vendor |
| POST | `/webhooks/stripe` | Process Stripe webhook events | Stripe |

### 🛡️ Admin Management

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/admin/stats` | Retrieve platform statistics | Admin |
| GET | `/admin/users` | Retrieve registered users | Admin |
| PATCH | `/admin/users/:id/block` | Block a user (if implemented) | Admin |
| PATCH | `/admin/users/:id/unblock` | Unblock a user (if implemented) | Admin |
| GET | `/admin/menu-items` | Retrieve menu items for review | Admin |
| PATCH | `/admin/menu-items/:id/status` | Approve or reject menu items | Admin |
| DELETE | `/admin/menu-items/:id` | Delete a menu item | Admin |
| GET | `/admin/transactions` | Retrieve subscription transactions | Admin |

### 🖼️ Image Upload

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/upload-image` | Upload an image through ImgBB | Authenticated |

## 🔐 Authentication & Authorization

PizzaHub uses Better Auth for user authentication and JWT tokens for protecting backend API requests.

**Authentication Flow:**

1. Users sign in through the client application using Better Auth.
2. The authenticated client obtains a JWT token.
3. The client includes the token in the Authorization header when making protected API requests.
4. The backend verifies the token using the configured JWT verification mechanism.
5. Authentication middleware identifies the requesting user.
6. Role-based middleware checks whether the user has permission to access the requested resource.
7. Ownership checks ensure users can only manage their permitted resources.

**Example Authorization Header:**

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

## 🔎 Advanced Search & Sorting

The menu API supports query parameters for searching, filtering, and sorting menu items.

**Example Request:**

```http
GET /menu?search=chicken&category=Classic&location=Dhaka&sort=price_asc
```

**Supported Operations:**

- Search menu items by name.
- Filter menu items by category.
- Filter restaurants by location.
- Sort prices in ascending order (`price_asc`).
- Sort prices in descending order (`price_desc`).
- Retrieve only approved and active menu items for public browsing.

## 🗄️ Database Collections

PizzaHub uses MongoDB to store application data.

| Collection | Description |
|---|---|
| `users` | Stores user profiles, roles, account status, and subscription information |
| `menuItems` | Stores restaurant menu items, prices, categories, availability, and approval status |
| `orders` | Stores customer orders, delivery information, and order statuses |
| `transactions` | Stores vendor subscription payment and transaction records |

Better Auth manages its own authentication-related data according to its configured database adapter.

## 🚀 Getting Started

Follow these steps to run the backend locally.

**1. Clone the repository**

```bash
git clone https://github.com/TaheraScript/PizzaHub-Server.git
```

**2. Navigate to the project directory**

```bash
cd PizzaHub-Server
```

**3. Install dependencies**

```bash
npm install
```

**4. Configure environment variables**

Create a `.env` file in the root directory and add the required environment variables:

```env

# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB
MONGODB_URI=your-mongodb-connection-string
MONGODB_DB_NAME=pizzahub

# Frontend URL
CLIENT_URL=http://localhost:3000

# JWT Authentication (must match the frontend JWT_SECRET)
JWT_SECRET=your-jwt-secret

# Stripe Payment Integration
STRIPE_SECRET_KEY=your-stripe-secret-key

# Better Auth JWKS
JWKS_URL=http://localhost:3000/api/auth/jwks

```bash
npm run dev
```

The API will run at:

```text
http://localhost:5000
```

## 🔒 Business Rules & Security

- **Role-Based Access:** Customers, Vendors, and Admins have separate permissions.
- **Menu Approval:** Newly submitted menu items require administrator approval before appearing publicly.
- **Menu Ownership:** Vendors can only manage menu items belonging to their own restaurants.
- **Order Restrictions:** Customers cannot order their own restaurant's menu items.
- **Duplicate Prevention:** Duplicate active orders for the same menu item and delivery date are restricted.
- **Order Cancellation:** Customers can cancel only pending orders.
- **Vendor Order Processing:** Vendors can accept or reject only pending orders belonging to their restaurants.
- **Free Plan Limit:** Free vendors can publish a maximum of three active menu items.
- **Premium Plan:** Premium vendors can publish unlimited active menu items.
- **Stripe Verification:** Subscription updates are processed through verified Stripe webhook events.
- **Transaction Security:** Payment transaction records are managed by the backend and cannot be edited by ordinary users.
- **Environment Security:** Secret keys and database credentials are stored in environment variables and must never be exposed publicly.

## 🔗 Relevant Links

- 🌐 **Live Client:** [PizzaHub](https://pizzahub-client-rust.vercel.app/)
- 💻 **Client Repository:** [PizzaHub Client](https://github.com/TaheraScript/PizzaHub-Client)
- ⚙️ **Server Repository:** [PizzaHub Server](https://github.com/TaheraScript/PizzaHub-Server)
- 🟢 **Node.js:** [nodejs.org](https://nodejs.org/)
- 🚂 **Express.js:** [expressjs.com](https://expressjs.com/)
- 🍃 **MongoDB:** [mongodb.com](https://www.mongodb.com/)
- 🔐 **Better Auth:** [better-auth.com](https://www.better-auth.com/)
- 💳 **Stripe:** [stripe.com](https://stripe.com/)
- 🖼️ **ImgBB:** [imgbb.com](https://imgbb.com/)



