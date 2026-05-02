const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('../config/database');
const DepartmentAdmin = require('../models/DepartmentAdmin');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const checkAdmins = async () => {
  try {
    await connectDB();
    console.log('Connected to DB');

    const admins = await DepartmentAdmin.find({});
    console.log(`Found ${admins.length} department admins.`);
    
    admins.forEach(admin => {
      console.log(`- ID: ${admin._id}, Name: ${admin.fullName}, Dept: ${admin.department}, DeptID: ${admin.departmentId}, Email: ${admin.email}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
};

checkAdmins();
