// Validation utilities for Awaz e Shehr
const validator = require('validator');

// Pakistani phone number validation
const validatePakistaniPhone = (phone) => {
  if (!phone) return { isValid: false, message: 'Phone number is required' };
  
  // Remove any spaces, dashes, or parentheses
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  
  // Pakistani phone number patterns:
  // +92XXXXXXXXXX (international format)
  // 03XXXXXXXXX (domestic format)
  // 92XXXXXXXXXX (without +)
  const phoneRegex = /^(\+92|92|0)?[0-9]{10}$/;
  
  if (!phoneRegex.test(cleanPhone)) {
    return { isValid: false, message: 'Invalid Pakistani phone number format' };
  }
  
  // Check if it's a valid Pakistani mobile number
  const mobileRegex = /^(\+92|92|0)?3[0-9]{9}$/;
  if (!mobileRegex.test(cleanPhone)) {
    return { isValid: false, message: 'Phone number must be a valid Pakistani mobile number' };
  }
  
  return { isValid: true, message: 'Valid phone number' };
};

// CNIC validation (13 digits without dashes)
const validateCNIC = (cnic) => {
  if (!cnic) return { isValid: false, message: 'CNIC is required' };
  
  // Remove any spaces or dashes
  const cleanCNIC = cnic.replace(/[\s\-]/g, '');
  
  // Check if it's exactly 13 digits
  if (!/^[0-9]{13}$/.test(cleanCNIC)) {
    return { isValid: false, message: 'CNIC must be exactly 13 digits without dashes' };
  }
  
  // Validate CNIC format (first digit should be 1-9, not 0)
  if (cleanCNIC[0] === '0') {
    return { isValid: false, message: 'CNIC cannot start with 0' };
  }
  
  return { isValid: true, message: 'Valid CNIC' };
};

// Email validation
const validateEmail = (email) => {
  if (!email) return { isValid: false, message: 'Email is required' };
  
  if (!validator.isEmail(email)) {
    return { isValid: false, message: 'Invalid email format' };
  }
  
  // Check email length
  if (email.length > 254) {
    return { isValid: false, message: 'Email is too long' };
  }
  
  return { isValid: true, message: 'Valid email' };
};

// Name validation
const validateName = (name) => {
  if (!name) return { isValid: false, message: 'Name is required' };
  
  // Check length
  if (name.length < 2) {
    return { isValid: false, message: 'Name must be at least 2 characters long' };
  }
  
  if (name.length > 50) {
    return { isValid: false, message: 'Name is too long (max 50 characters)' };
  }
  
  // Check for valid characters (letters and spaces only)
  if (!/^[a-zA-Z\s]+$/.test(name)) {
    return { isValid: false, message: 'Name can only contain letters and spaces' };
  }
  
  // Check for consecutive spaces
  if (/\s{2,}/.test(name)) {
    return { isValid: false, message: 'Name cannot contain consecutive spaces' };
  }
  
  return { isValid: true, message: 'Valid name' };
};

// Password validation
const validatePassword = (password) => {
  if (!password) return { isValid: false, message: 'Password is required' };
  
  // 1 Digit, 1 small Alphabet, 1 capital alphabet, 1 Special Character, length must be 6 or greater
  const passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{6,}$/;

  if (!passwordRegex.test(password)) {
    return { isValid: false, message: 'fulfill requirements of password' };
  }
  
  if (password.length > 128) {
    return { isValid: false, message: 'Password is too long (max 128 characters)' };
  }
  
  return { isValid: true, message: 'Valid password' };
};

// Department validation
const validateDepartment = (department) => {
  if (!department) return { isValid: false, message: 'Department is required' };
  
  if (department.length < 2) {
    return { isValid: false, message: 'Department name must be at least 2 characters long' };
  }
  
  if (department.length > 100) {
    return { isValid: false, message: 'Department name is too long' };
  }
  
  return { isValid: true, message: 'Valid department' };
};

// Validate all citizen registration fields
const validateCitizenRegistration = (data) => {
  const errors = [];
  
  // Validate full name
  const nameValidation = validateName(data.fullName);
  if (!nameValidation.isValid) errors.push(nameValidation.message);
  
  // Validate email
  const emailValidation = validateEmail(data.email);
  if (!emailValidation.isValid) errors.push(emailValidation.message);
  
  // Validate phone
  const phoneValidation = validatePakistaniPhone(data.phone);
  if (!phoneValidation.isValid) errors.push(phoneValidation.message);
  
  // Validate CNIC
  const cnicValidation = validateCNIC(data.cnic);
  if (!cnicValidation.isValid) errors.push(cnicValidation.message);
  
  // Validate password
  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.isValid) errors.push(passwordValidation.message);
  
  // Validate password confirmation
  if (data.password !== data.confirmPassword) {
    errors.push('Passwords do not match');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors,
    message: errors.length === 0 ? 'All fields are valid' : 'Validation errors found'
  };
};

// Validate login identifier (email, phone, or CNIC for citizens)
const validateLoginIdentifier = (identifier, role) => {
  if (!identifier) return { isValid: false, message: 'Identifier is required' };
  
  if (role === 'citizen') {
    // For citizens, check if it's email, phone, or CNIC
    const emailValidation = validateEmail(identifier);
    const phoneValidation = validatePakistaniPhone(identifier);
    const cnicValidation = validateCNIC(identifier);
    
    if (emailValidation.isValid || phoneValidation.isValid || cnicValidation.isValid) {
      return { isValid: true, message: 'Valid identifier' };
    } else {
      return { isValid: false, message: 'Invalid identifier. Please enter a valid email, phone number, or CNIC' };
    }
  } else {
    // For other roles, only email is allowed
    return validateEmail(identifier);
  }
};

module.exports = {
  validatePakistaniPhone,
  validateCNIC,
  validateEmail,
  validateName,
  validatePassword,
  validateDepartment,
  validateCitizenRegistration,
  validateLoginIdentifier
};
