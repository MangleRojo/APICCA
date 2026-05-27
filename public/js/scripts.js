import { DotsBackground } from './components/DotsBackground.js';

document.addEventListener('DOMContentLoaded', () => {
    // Background Animation (se omite en el Home rediseñado tipo "rack")
    const mainContainer = document.querySelector('main');
    if (mainContainer && !document.body.classList.contains('te-home')) {
        new DotsBackground(mainContainer);
    }

    // Mobile Menu Logic
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('nav');

    if (menuToggle && nav) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            nav.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!nav.contains(e.target) && !menuToggle.contains(e.target)) {
                nav.classList.remove('active');
            }
        });
    }
});
