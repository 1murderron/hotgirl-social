// Tip Jar Dashboard JavaScript
let tipJarSettings = {
  enabled: false,
  message: ''
};

// Load current tip jar settings when dashboard loads
async function loadTipJarSettings() {
  try {
    const token = localStorage.getItem('userToken');
    const response = await fetch('/api/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const profile = await response.json();
    
    tipJarSettings.enabled = profile.tip_jar_enabled || false;
    tipJarSettings.message = profile.tip_jar_message || '';
    
    // Update UI
    document.getElementById('tip-jar-enabled').checked = tipJarSettings.enabled;
    document.getElementById('tip-jar-message').value = tipJarSettings.message;
    updateCharacterCount();
    
    // Load stats and recent tips
    loadTipStats();
    loadRecentTips();
    
  } catch (error) {
    console.error('Error loading tip jar settings:', error);
  }
}

// Save tip jar settings
async function saveTipJarSettings() {
  try {
    const enabled = document.getElementById('tip-jar-enabled').checked;
    const message = document.getElementById('tip-jar-message').value;
    
    const token = localStorage.getItem('userToken');
    const response = await fetch('/api/profile/tip-jar', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ enabled, message })
    });
    
    if (response.ok) {
      showMessage('Tip jar settings saved successfully!', 'success');
      tipJarSettings = { enabled, message };
    } else {
      const error = await response.json();
      showMessage('Error: ' + error.error, 'error');
    }
  } catch (error) {
    console.error('Error saving tip jar settings:', error);
    showMessage('Failed to save settings. Please try again.', 'error');
  }
}

// Load tip statistics
async function loadTipStats() {
  try {
    const token = localStorage.getItem('userToken');
    const response = await fetch('/api/tips/history', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    const tips = data.tips || [];
    
    // Calculate this month's stats
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const thisMonthTips = tips.filter(tip => {
      const tipDate = new Date(tip.created_at);
      return tipDate.getMonth() === currentMonth && tipDate.getFullYear() === currentYear;
    });
    
    const totalAmount = thisMonthTips.reduce((sum, tip) => sum + parseFloat(tip.amount_dollars), 0);
    const totalEarnings = thisMonthTips.reduce((sum, tip) => sum + parseFloat(tip.creator_amount), 0);
    const platformFee = totalAmount - totalEarnings;
    
    document.getElementById('monthly-tip-total').textContent = `$${totalAmount.toFixed(0)}`;
    document.getElementById('monthly-tip-count').textContent = thisMonthTips.length;
    document.getElementById('monthly-earnings').textContent = `$${totalEarnings.toFixed(0)}`;
    document.getElementById('platform-fee').textContent = `$${platformFee.toFixed(0)}`;
    
  } catch (error) {
    console.error('Error loading tip stats:', error);
  }
}

// Load recent tips
async function loadRecentTips() {
  try {
    const token = localStorage.getItem('userToken');
    const response = await fetch('/api/tips/history', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    const tips = data.tips || [];
    
    const recentTipsList = document.getElementById('recent-tips-list');
    
    if (tips.length === 0) {
      recentTipsList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No tips yet</p>';
      return;
    }
    
    recentTipsList.innerHTML = tips.slice(0, 10).map(tip => `
      <div class="tip-item">
        <div>
          <div class="tip-email">${tip.tipper_email || 'Anonymous'}</div>
          <div class="tip-date">${new Date(tip.created_at).toLocaleDateString()}</div>
        </div>
        <div class="tip-amount">$${parseFloat(tip.amount_dollars).toFixed(0)}</div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading recent tips:', error);
    document.getElementById('recent-tips-list').innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">Error loading tips</p>';
  }
}

// Update character count for message
function updateCharacterCount() {
  const message = document.getElementById('tip-jar-message').value;
  document.getElementById('message-char-count').textContent = message.length;
}

// Add event listeners when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Load tip jar settings when dashboard loads
  loadTipJarSettings();
  
  // Add event listeners
  const messageInput = document.getElementById('tip-jar-message');
  const saveButton = document.getElementById('save-tip-settings');
  
  if (messageInput) {
    messageInput.addEventListener('input', updateCharacterCount);
  }
  
  if (saveButton) {
    saveButton.addEventListener('click', saveTipJarSettings);
  }
});