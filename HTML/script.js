// scripts.js
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');
  
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs
        tabs.forEach((t) => t.classList.remove('active'));
        // Remove active class from all content sections
        contents.forEach((c) => c.classList.remove('active'));
  
        // Add active class to the clicked tab
        tab.classList.add('active');
        // Add active class to the corresponding content section
        const targetId = tab.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
      });
    });
  });
  
  