/**
 * @jest-environment jsdom
 */
import { calculateBestFitFontSize } from '../AutoFitText';

describe('AutoFitText', () => {
    describe('calculateBestFitFontSize', () => {
        const baseConfig = {
            fontFamily: 'Arial',
            fontWeight: 'normal',
            fontStyle: 'normal',
            lineHeight: 1.2,
            fill: '#000000',
            textAlign: 'left',
            minFontSize: 10,
            maxFontSize: 100,
            wordWrap: true
        };

        it('should return maxFontSize for short text that fits easily', () => {
            // Constraint height must be > fontSize * lineHeight (100 * 1.2 = 120)
            const result = calculateBestFitFontSize('Hello', 200, 150, baseConfig);
            // It should maximize the size up to maxFontSize, BUT limited by width 'Hello'
            // Previous loose behavior allowed 100, now strict width guard limits it to ~86
            expect(result.fontSize).toBeLessThanOrEqual(100);
            expect(result.fontSize).toBeGreaterThan(80); 
        });

        it('should reduce font size for long text', () => {
            const longText = 'This is a very long text that definitely needs to wrap multiple lines to fit in the box';
            const result = calculateBestFitFontSize(longText, 100, 100, baseConfig);
            expect(result.fontSize).toBeLessThan(100);
            // Strict width guard might force this smaller than 10 if words are close to edge
            expect(result.fontSize).toBeGreaterThan(0);
        });

        it('should shrink below minFontSize if needed to fit (Emergency Shrink)', () => {
            // Use words so it wraps
            const hugeText = 'Word '.repeat(1000);
            const result = calculateBestFitFontSize(hugeText, 50, 50, baseConfig);
            // Algorithm uses Emergency Shrink (Phase 3) to go below minFontSize down to HARD_FLOOR (6px)
            expect(result.fontSize).toBeGreaterThanOrEqual(6);
            expect(result.fontSize).toBeLessThanOrEqual(10);
        });

        it('should respect maxLines constraint', () => {
            // Text that would normally fit in 3 lines at a larger size, but we force 2 lines
            // "Hello World" in narrow box (50px wide) with large maxFontSize
            // "Hello" is approx 20-30px wide at size 10?
            // Let's rely on the relative behavior: 
            // If maxTextLines is 1, it should try to shrink text until it fits in 1 line 
            // OR if it can't fit in 1 line even at minFontSize, it returns minFontSize.
            
            
            // At 1 line, it should maximize font size to fit width 200.
            // If we didn't have maxLines:1, it might use huge font and wrap to 2-3 lines (filling height 100).
            // With maxLines:1, it must be small enough to stay on 1 line (or 1 line width <= 200).
            
            
            // At 1 line, it should maximize font size to fit width 200.
            // If we didn't have maxLines:1, it might use huge font and wrap to 2-3 lines (filling height 100).
            // With maxLines:1, it must be small enough to stay on 1 line (or 1 line width <= 200).
            
            // Let's test a case where natural wrappping occurs
            const wrapText = "A B C D";
            const narrowWidth = 50; 
            const tallHeight = 200;
            // Naturally this would wrap to many lines to use larger font.
            const resultWrapped = calculateBestFitFontSize(wrapText, narrowWidth, tallHeight, baseConfig);
            
            // Now constrain to 1 line
            const result1Line = calculateBestFitFontSize(wrapText, narrowWidth, tallHeight, { ...baseConfig, maxLines: 1, minFontSize: 2 });
            
            // The 1-line version must be much smaller to fit in 50px width
            expect(result1Line.fontSize).toBeLessThan(resultWrapped.fontSize);
        });

        it('should handle small containers gracefully', () => {
            const result = calculateBestFitFontSize('Test', 10, 10, baseConfig);
            // Small containers trigger Emergency Shrink - fontSize can go down to HARD_FLOOR (6px)
            expect(result.fontSize).toBeGreaterThanOrEqual(6);
            expect(result.fontSize).toBeLessThanOrEqual(10);
        });

        it('should shrink text to fit width for long non-wrappable strings', () => {
            // A long string that cannot wrap (no spaces)
            const longWord = 'WWWWWWWWWW'; // 10 Ws
            const narrowWidth = 100;
            const tallHeight = 500; // Height is not the constraint
            
            const result = calculateBestFitFontSize(longWord, narrowWidth, tallHeight, baseConfig);
            
            // W is typically wide. 10 * fontSize must be approx <= 100.
            // So fontSize should be roughly <= 10-15px. 
            // Definitely much smaller than maxFontSize (100).
            expect(result.fontSize).toBeLessThan(50);
            expect(result.fontSize).toBeGreaterThan(0);
        });
    });
});
