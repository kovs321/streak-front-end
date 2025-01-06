// Target the elements
const magicButton = document.getElementById('magicButton');
const title = document.getElementById('title');
const colorBox = document.getElementById('colorBox');

// Add click event listener to the button
magicButton.addEventListener('click', () => {
    // Change the title color and animate
    title.style.color = getRandomColor();
    title.style.transform = "rotate(360deg) scale(1.2)";

    // Change the box color and size
    colorBox.style.backgroundColor = getRandomColor();
    colorBox.style.width = getRandomSize() + "px";
    colorBox.style.height = getRandomSize() + "px";

    // Reset the animation after some time
    setTimeout(() => {
        title.style.transform = "rotate(0deg) scale(1)";
    }, 500);
});

// Function to generate a random color
function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Function to generate a random size
function getRandomSize() {
    return Math.floor(Math.random() * 200) + 50; // Between 50px and 250px
}
