const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware
 * Verifies JWT token from Authorization header
 * Adds userId and userRole to request object
 */
const auth = (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    // Check if token exists
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'No token provided. Access denied.' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add user info to request
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    
    next();
  } catch (error) {
    // Handle different JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token expired. Please login again.' 
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token. Please login again.' 
      });
    }
    
    res.status(401).json({ 
      success: false,
      message: 'Authentication failed.' 
    });
  }
};

module.exports = auth;