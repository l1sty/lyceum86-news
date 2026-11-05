'use client';
export default function Error({ reset }: { reset: () => void }) { return <div className="container error-page"><h1>Сторінку не вдалося завантажити</h1><p>Перевірте з’єднання та спробуйте ще раз.</p><button className="button button-dark" onClick={reset}>Спробувати ще раз</button></div>; }
