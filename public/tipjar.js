// Add this JavaScript to your profile.html file (or separate JS file)

let currentProfileData = null;

// Initialize tip jar when profile loads
function initializeTipJar(profileData) {
  currentProfileData = profileData;
  
  // Show tip jar if enabled
  if (profileData.tip_jar_enabled) {
    document.getElementById('tip-jar-section').style.display = 'block';
    
    // Set custom message or default
    const messageElement = document.getElementById('tip-jar-message');
    const message = profileData.tip_jar_message || `Support ${profileData.display_name || profileData.username} with a tip`;
    messageElement.textContent = message.replace('{creator_name}', profileData.display_name || profileData.username);
    
    // Load monthly tip stats
    loadMonthlyTipStats(profileData.id);
  }
  
  // Add event listeners for tip buttons
  setupTipEventListeners();
}

// Set up event listeners for tip buttons
function setupTipEventListeners() {
  // Quick amount buttons
  document.querySelectorAll('.tip-btn[data-amount]').forEach(button => {
    button.addEventListener('click', (e) => {
      const amount = parseInt(e.target.dataset.amount);
      processTip(amount);
    });
  });
  
  /*
  // Custom amount button
  document.getElementById('tip-custom-btn').addEventListener('click', () => {
    const customAmount = parseInt(document.getElementById('custom-amount').value);
    if (customAmount && customAmount >= 5 && customAmount <= 500) {
      processTip(customAmount);
    } else {
      alert('Please enter a valid amount between $5 and $500');
    }
  });
  */

    // COOLER Custom amount button
document.getElementById('tip-custom-btn').addEventListener('click', () => {
  const customAmount = parseInt(document.getElementById('custom-amount').value);
  
  if (!customAmount) {
    alert('Please enter a tip amount');
  } else if (customAmount < 5) {
    alert('Come on, ya cheap bastard! Minimum tip is $5 😏');
  } else if (customAmount > 500) {
    alert('Whoa! Calm down big baller. Max tip is $500 💸');
  } else {
    processTip(customAmount);
  }
});


  // Enter key on custom amount input
  document.getElementById('custom-amount').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('tip-custom-btn').click();
    }
  });
}

// Process tip payment
async function processTip(amount) {
  try {
    // Show loading state
    const buttons = document.querySelectorAll('.tip-btn');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.textContent = btn.textContent.includes('...') ? btn.textContent : btn.textContent + '...';
    });
    
    // Create tip checkout session
    const response = await fetch('/api/tips/create-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profileId: currentProfileData.id,
        amount: amount,
        creatorName: currentProfileData.display_name || currentProfileData.username
      })
    });
    
    const sessionData = await response.json();
    
    if (sessionData.error) {
      throw new Error(sessionData.error);
    }
    
    // Redirect to Stripe checkout
    const stripe = Stripe(window.stripePublishableKey);
    await stripe.redirectToCheckout({
      sessionId: sessionData.sessionId
    });
    
  } catch (error) {
    console.error('Tip processing error:', error);
    alert('Sorry, there was an error processing your tip. Please try again.');
    
    // Reset button states
    resetTipButtons();
  }
}

// Reset tip buttons to normal state
function resetTipButtons() {
  document.querySelectorAll('.tip-btn[data-amount]').forEach(button => {
    button.disabled = false;
    button.textContent = `$${button.dataset.amount}`;
  });
  
  const customBtn = document.getElementById('tip-custom-btn');
  customBtn.disabled = false;
  customBtn.textContent = 'Tip Custom Amount';
}

// Load monthly tip statistics
async function loadMonthlyTipStats(profileId) {
  try {
    const response = await fetch(`/api/tips/monthly-stats/${profileId}`);
    const stats = await response.json();
    
    if (stats.totalAmount > 0) {
      document.getElementById('recent-tips').style.display = 'block';
      document.getElementById('monthly-total').textContent = `$${stats.totalAmount}`;
      document.getElementById('tip-count').textContent = stats.tipCount;
    }
  } catch (error) {
    console.error('Error loading tip stats:', error);
  }
}

// Update your existing profile loading code to include tip jar initialization
// This should be added to your existing profile.html where you load profile data

// Make sure Stripe is available globally
window.stripePublishableKey = 'pk_test_51RoD4t2Hj566duWcRxvEvVdnaQg3wDLd3XesTLLrRED7FHiwkEXcm1YukrjQW7ayFTL9XZCd7QtczlGgHF3y2iw800jq3b4GL8';

// Example integration with your existing loadProfile function:
/*
async function loadProfile() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/profile-data/${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error('Profile not found');

        const profile = await response.json();
        displayProfile(profile);
        initializeTipJar(profile); // Add this line to initialize tip jar
    } catch (err) {
        console.error('Error loading profile:', err);
        showError();
    }
}
*/