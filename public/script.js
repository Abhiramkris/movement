

 const burger = document.querySelector('.burger');
const navLinks = document.querySelector('.nav-links');

burger.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

const testimonials = [
    {
        text: "This is the best service I have ever used.",
        author: "John Doe",
        avatar: "https://randomuser.me/api/portraits/men/1.jpg"
    },
    {
        text: "Amazing experience, highly recommended!",
        author: "Jane Smith",
        avatar: "https://randomuser.me/api/portraits/women/1.jpg"
    },
    {
        text: "Very satisfied with the quality of service.",
        author: "Alice Johnson",
        avatar: "https://randomuser.me/api/portraits/women/2.jpg"
    },
    {
        text: "I will definitely use this service again.",
        author: "Bob Brown",
        avatar: "https://randomuser.me/api/portraits/men/2.jpg"
    }
];

let currentTestimonial = 0;

const avatarElement = document.getElementById('avatar');
const testimonialTextElement = document.getElementById('testimonial-text');
const authorElement = document.getElementById('author');
const testimonialCard = document.getElementById('testimonial-card');

function updateTestimonial(index) {
    avatarElement.src = testimonials[index].avatar;
    testimonialTextElement.textContent = testimonials[index].text;
    authorElement.textContent = testimonials[index].author;
}

function changeTestimonial(direction) {
    testimonialCard.style.opacity = 0;
    setTimeout(() => {
        currentTestimonial = (currentTestimonial + direction + testimonials.length) % testimonials.length;
        updateTestimonial(currentTestimonial);
        testimonialCard.style.opacity = 1;
    }, 500);
}

document.getElementById('prev').addEventListener('click', () => changeTestimonial(-1));
document.getElementById('next').addEventListener('click', () => changeTestimonial(1));

setInterval(() => changeTestimonial(1), 5000);

window.onload = () => updateTestimonial(currentTestimonial);
