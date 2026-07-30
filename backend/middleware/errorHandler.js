/**
 * Global Error Handler Middleware
 * Catches all errors and sends formatted response
 */
const errorHandler = (err, req, res, next) => {
  // Log error to console (for debugging)
  console.error('❌ Error:', err.stack);
  
  // Default values
  let statusCode = err.status || 500;
  let message = err.message || 'Something went wrong!';
  
  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(e => e.message).join(', ');
  }
  
  // Handle Mongoose duplicate key errors
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyPattern)[0];
    message = `Duplicate value for ${field}. Please use a unique value.`;
  }
  
  // Handle Mongoose CastError (invalid ID)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }
  
  // Send response
  res.status(statusCode).json({
    success: false,
    message,
    // Show stack trace only in development
    stack: process.env.NODE_ENV === 'development' ? err.stack : {}
  });
};

module.exports = errorHandler;