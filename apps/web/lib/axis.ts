/** Chart x-axis labels: the time of day is enough within a day; longer ranges need the date too. */
export const axisTime = (range: string) => (t: number) => {
  const d = new Date(t);
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return range === '24h' || range === '7d'
    ? `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm}`
    : hm;
};
